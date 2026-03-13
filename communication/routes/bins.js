const express = require('express');
const db = require('../../config/database');
// const mqttService = require('../services/mqttService');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

const canUseMqtt = () =>
    (typeof mqttService !== 'undefined') && mqttService &&
    (typeof mqttService.publishNotification === 'function' ||
        typeof mqttService.publishBinLevel === 'function' ||
        typeof mqttService.publishBinStatus === 'function');

// Get all bins
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, assigned_to } = req.query;
        
        let query = `
            SELECT b.*, u.name AS collector_name, u.email AS collector_email
            FROM bins b
            LEFT JOIN users u ON b.assigned_to = u.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (status) {
            query += ` AND b.status = $${paramIndex++}`;
            params.push(status);
        }

        if (assigned_to) {
            query += ` AND b.assigned_to = $${paramIndex++}`;
            params.push(assigned_to);
        }

        // If user is a collector, only show their assigned bins
        if (req.user.role === 'collector') {
            query += ` AND b.assigned_to = $${paramIndex++}`;
            params.push(req.user.id);
        }

        query += ' ORDER BY b.fill_level DESC, b.bin_code ASC';

        const result = await db.query(query, params);
        const bins = Array.isArray(result.rows) ? result.rows : [];

        res.json({
            success: true,
            data: bins
        });

    } catch (error) {
        console.error('Get bins error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get single bin by ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const binId = req.params.id;

        let query = `
            SELECT b.*, u.name AS collector_name, u.email AS collector_email
            FROM bins b
            LEFT JOIN users u ON b.assigned_to = u.id
            WHERE b.id = $1
        `;
        const params = [binId];

        // If user is a collector, ensure they can only access their assigned bins
        if (req.user.role === 'collector') {
            query += ' AND b.assigned_to = $2';
            params.push(req.user.id);
        }

        console.log('Get bin by id query:', query.trim(), 'params:', params);
        const result = await db.query(query, params);
        const bins = Array.isArray(result.rows) ? result.rows : [];

        if (bins.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Bin not found or access denied' 
            });
        }

        res.json({
            success: true,
            data: bins[0]
        });

    } catch (error) {
        console.error('Get bin error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Create new bin (Admin only)
router.post('/', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { bin_code, location, latitude, longitude, capacity, assigned_to } = req.body;

        // Validation
        if (!bin_code || !location) {
            return res.status(400).json({ 
                success: false, 
                message: 'Bin code and location are required' 
            });
        }

        // Check if bin code already exists
        const existingBinsResult = await db.query(
            'SELECT id FROM bins WHERE bin_code = $1',
            [bin_code]
        );
        const existingBins = existingBinsResult.rows || [];

        if (existingBins.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: 'Bin code already exists' 
            });
        }

        // Insert bin
        const insertResult = await db.query(
            `INSERT INTO bins (bin_code, location, latitude, longitude, capacity, assigned_to, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
                bin_code, 
                location, 
                latitude || null, 
                longitude || null, 
                capacity || 100, 
                assigned_to || null,
                'normal'
            ]
        );
        const newBin = insertResult.rows[0] || { id: null };
        const newBinId = newBin.id;

        // Create notification for assigned collector
        if (assigned_to && newBinId) {
            await db.query(
                `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                 VALUES ($1, $2, 'info', 'New Bin Assigned', $3)`,
                [assigned_to, newBinId, `Bin ${bin_code} has been assigned to you at ${location}`]
            );

            // Send MQTT notification
            if (typeof mqttService !== 'undefined' && mqttService.publishNotification) {
                mqttService.publishNotification(assigned_to, {
                    type: 'info',
                    title: 'New Bin Assigned',
                    message: `Bin ${bin_code} has been assigned to you at ${location}`,
                    bin_id: newBinId,
                    timestamp: new Date()
                });
            }
        }

        res.status(201).json({
            success: true,
            message: 'Bin created successfully',
            data: {
                id: newBinId,
                bin_code,
                location
            }
        });

    } catch (error) {
        console.error('Create bin error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Update bin (Admin only)
router.put('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { location, latitude, longitude, capacity, assigned_to, status } = req.body;
        const binId = req.params.id;

        // Get current bin data
        const currentBinResult = await db.query('SELECT * FROM bins WHERE id = $1', [binId]);
        const currentBinRows = currentBinResult.rows || [];
        
        if (currentBinRows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Bin not found' 
            });
        }

        // Build update query
        const updates = [];
        const params = [];

        if (location) {
            params.push(location);
            updates.push(`location = $${params.length}`);
        }
        if (latitude !== undefined) {
            params.push(latitude);
            updates.push(`latitude = $${params.length}`);
        }
        if (longitude !== undefined) {
            params.push(longitude);
            updates.push(`longitude = $${params.length}`);
        }
        if (capacity) {
            params.push(capacity);
            updates.push(`capacity = $${params.length}`);
        }
        if (assigned_to !== undefined) {
            params.push(assigned_to);
            updates.push(`assigned_to = $${params.length}`);
        }
        if (status) {
            params.push(status);
            updates.push(`status = $${params.length}`);
        }

        if (updates.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No fields to update' 
            });
        }

        params.push(binId);
        const idParamIndex = params.length;

        const updateQuery = `UPDATE bins SET ${updates.join(', ')} WHERE id = $${idParamIndex}`;
        console.log('Update bin query:', updateQuery, 'params:', params);
        const updateResult = await db.query(updateQuery, params);

        if (!updateResult || updateResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Bin not found'
            });
        }

        // If assignment changed, notify the new collector
        const currentBin = currentBinRows[0];
        if (assigned_to !== undefined && assigned_to !== currentBin.assigned_to) {
            if (assigned_to) {
                await db.query(
                    `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                     VALUES ($1, $2, 'info', 'Bin Assigned', $3)`,
                    [assigned_to, binId, `Bin ${currentBin.bin_code} has been assigned to you`]
                );

                if (typeof mqttService !== 'undefined' && mqttService && mqttService.publishNotification) {
                    mqttService.publishNotification(assigned_to, {
                        type: 'info',
                        title: 'Bin Assigned',
                        message: `Bin ${currentBin.bin_code} has been assigned to you`,
                        bin_id: binId,
                        timestamp: new Date()
                    });
                }
            }
        }

        res.json({
            success: true,
            message: 'Bin updated successfully'
        });

    } catch (error) {
        console.error('Update bin error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Update bin fill level (usually from IoT sensor via MQTT)
router.patch('/:id/level', async (req, res) => {
    try {
        const { fill_level } = req.body;
        const binId = req.params.id;

        if (fill_level === undefined || fill_level < 0 || fill_level > 100) {
            return res.status(400).json({ 
                success: false, 
                message: 'Valid fill level (0-100) is required' 
            });
        }

        // Get current bin
        const binResult = await db.query('SELECT * FROM bins WHERE id = $1', [binId]);
        const bins = Array.isArray(binResult.rows) ? binResult.rows : [];

        if (bins.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Bin not found' 
            });
        }

        const bin = bins[0];

        // Determine new status based on fill level
        let newStatus = 'normal';
        if (fill_level >= 85) {
            newStatus = 'critical';
        } else if (fill_level >= 60) {
            newStatus = 'warning';
        }

        // Update bin
        const updateLevelResult = await db.query(
            'UPDATE bins SET fill_level = $1, status = $2 WHERE id = $3',
            [fill_level, newStatus, binId]
        );

        if (!updateLevelResult || updateLevelResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Bin not found'
            });
        }

        // Create notification if status changed to critical or warning
        if (newStatus === 'critical' && bin.status !== 'critical') {
            const notificationMessage = `Bin ${bin.bin_code} at ${bin.location} is ${fill_level}% full and requires immediate collection`;
            
            // Notify assigned collector
            if (bin.assigned_to) {
                await db.query(
                    `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                     VALUES ($1, $2, 'critical', 'Urgent Collection Required', $3)`,
                    [bin.assigned_to, binId, notificationMessage]
                );

                if (typeof mqttService !== 'undefined' && mqttService && mqttService.publishNotification) {
                    mqttService.publishNotification(bin.assigned_to, {
                        type: 'critical',
                        title: 'Urgent Collection Required',
                        message: notificationMessage,
                        bin_id: binId,
                        bin_code: bin.bin_code,
                        fill_level: fill_level,
                        timestamp: new Date()
                    });
                }
            }

            // Also notify admins
            const adminsResult = await db.query('SELECT id FROM users WHERE role = $1', ['admin']);
            const admins = Array.isArray(adminsResult.rows) ? adminsResult.rows : [];
            for (const admin of admins) {
                await db.query(
                    `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                     VALUES ($1, $2, 'critical', 'Critical Bin Alert', $3)`,
                    [admin.id, binId, notificationMessage]
                );
            }
        } else if (newStatus === 'warning' && bin.status === 'normal') {
            if (bin.assigned_to) {
                const notificationMessage = `Bin ${bin.bin_code} at ${bin.location} is ${fill_level}% full`;
                
                await db.query(
                    `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                     VALUES ($1, $2, 'warning', 'Collection Recommended', $3)`,
                    [bin.assigned_to, binId, notificationMessage]
                );

                if (typeof mqttService !== 'undefined' && mqttService && mqttService.publishNotification) {
                    mqttService.publishNotification(bin.assigned_to, {
                        type: 'warning',
                        title: 'Collection Recommended',
                        message: notificationMessage,
                        bin_id: binId,
                        bin_code: bin.bin_code,
                        fill_level: fill_level,
                        timestamp: new Date()
                    });
                }
            }
        }

        // Publish to MQTT
        if (typeof mqttService !== 'undefined' && mqttService) {
            if (mqttService.publishBinLevel) mqttService.publishBinLevel(bin.bin_code, fill_level);
            if (mqttService.publishBinStatus) mqttService.publishBinStatus(bin.bin_code, { status: newStatus, fill_level });
        }

        res.json({
            success: true,
            message: 'Bin level updated',
            data: {
                fill_level,
                status: newStatus
            }
        });

    } catch (error) {
        console.error('Update bin level error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Mark bin as collected
router.post('/:id/collect', authenticateToken, async (req, res) => {
    try {
        const binId = req.body.id || req.params.id;
        const { notes } = req.body;

        if (!binId) {
            return res.status(400).json({
                success: false,
                message: 'binId is required'
            });
        }

        // Get bin details
        const binQuery = 'SELECT * FROM bins WHERE id = $1';
        console.log('Collect bin get query:', binQuery, 'params:', [binId]);
        const binsResult = await db.query(binQuery, [binId]);
        const bins = binsResult.rows || [];
        
        if (bins.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Bin not found' 
            });
        }

        const bin = bins[0];

        // If collector, ensure they can only collect their assigned bins
        if (req.user.role === 'collector' && bin.assigned_to !== req.user.id) {
            return res.status(403).json({ 
                success: false, 
                message: 'You can only collect bins assigned to you' 
            });
        }

        const fillLevelBefore = bin.fill_level;

        // Record collection
        const insertCollectionQuery = `
            INSERT INTO collections (bin_id, collector_id, fill_level_before, fill_level_after, notes) 
            VALUES ($1, $2, $3, 0, $4)
        `;
        console.log('Collect bin insert collection query:', insertCollectionQuery.trim(), 'params:', [
            binId, req.user.id, fillLevelBefore, notes || null
        ]);
        await db.query(insertCollectionQuery, [
            binId, req.user.id, fillLevelBefore, notes || null
        ]);

        // Update bin status
        const updateBinQuery = `
            UPDATE bins
            SET fill_level = 0, status = 'normal', last_collection = NOW()
            WHERE id = $1
        `;
        console.log('Collect bin update bin query:', updateBinQuery.trim(), 'params:', [binId]);
        const updateResult = await db.query(updateBinQuery, [binId]);

        if (!updateResult || updateResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Bin not found'
            });
        }

        // Create success notification
        const notificationQuery = `
            INSERT INTO notifications (user_id, bin_id, type, title, message) 
            VALUES ($1, $2, 'success', 'Collection Completed', $3)
        `;
        console.log('Collect bin notification query:', notificationQuery.trim(), 'params:', [
            req.user.id, binId, `You successfully collected bin ${bin.bin_code}`
        ]);
        await db.query(notificationQuery, [
            req.user.id, binId, `You successfully collected bin ${bin.bin_code}`
        ]);

        // Publish to MQTT
        if (typeof mqttService !== 'undefined') {
            if (mqttService.publishBinLevel) {
                mqttService.publishBinLevel(bin.bin_code, 0);
            }
            if (mqttService.publishBinStatus) {
                mqttService.publishBinStatus(bin.bin_code, { 
                    status: 'normal', 
                    fill_level: 0,
                    last_collection: new Date()
                });
            }
        }

        res.json({
            success: true,
            message: 'Bin marked as collected',
            data: {
                bin_code: bin.bin_code,
                fill_level_before: fillLevelBefore
            }
        });

    } catch (error) {
        console.error('Collect bin error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Delete bin (Admin only)
router.delete('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const binId = req.params.id;

        const deleteQuery = 'DELETE FROM bins WHERE id = $1';
        console.log('Delete bin query:', deleteQuery, 'params:', [binId]);
        const deleteResult = await db.query(deleteQuery, [binId]);

        if (!deleteResult || deleteResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Bin not found'
            });
        }

        res.json({
            success: true,
            message: 'Bin deleted successfully'
        });

    } catch (error) {
        console.error('Delete bin error:', error);

        if (error.code === '23503') {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete bin because there are related records (e.g. collections)'
            });
        }

        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get bin collection history
router.get('/:id/history', authenticateToken, async (req, res) => {
    try {
        const binId = req.params.id;

        const historyQuery = `
            SELECT c.*, u.name AS collector_name
            FROM collections c
            JOIN users u ON c.collector_id = u.id
            WHERE c.bin_id = $1
            ORDER BY c.collection_time DESC
            LIMIT 50
        `;
        console.log('Get bin history query:', historyQuery.trim(), 'params:', [binId]);
        const collectionsResult = await db.query(historyQuery, [binId]);
        const collections = Array.isArray(collectionsResult.rows)
            ? collectionsResult.rows
            : [];

        res.json({
            success: true,
            data: collections
        });

    } catch (error) {
        console.error('Get bin history error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

module.exports = router;