const express = require('express');
const db = require('../../config/database');
// const mqttService = require('../services/mqttService');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

// Get all bins
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { status, assigned_to } = req.query;
        
        let query = `
            SELECT b.*, u.name as collector_name, u.email as collector_email
            FROM bins b
            LEFT JOIN users u ON b.assigned_to = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND b.status = ?';
            params.push(status);
        }

        if (assigned_to) {
            query += ' AND b.assigned_to = ?';
            params.push(assigned_to);
        }

        // If user is a collector, only show their assigned bins
        if (req.user.role === 'collector') {
            query += ' AND b.assigned_to = ?';
            params.push(req.user.id);
        }

        query += ' ORDER BY b.fill_level DESC, b.bin_code ASC';

        const [bins] = await db.query(query, params);

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
        let query = `
            SELECT b.*, u.name as collector_name, u.email as collector_email
            FROM bins b
            LEFT JOIN users u ON b.assigned_to = u.id
            WHERE b.id = ?
        `;
        const params = [req.params.id];

        // If user is a collector, ensure they can only access their assigned bins
        if (req.user.role === 'collector') {
            query += ' AND b.assigned_to = ?';
            params.push(req.user.id);
        }

        const [bins] = await db.query(query, params);

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
        const [existingBins] = await db.query(
            'SELECT id FROM bins WHERE bin_code = ?',
            [bin_code]
        );

        if (existingBins.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: 'Bin code already exists' 
            });
        }

        // Insert bin
        const [result] = await db.query(
            `INSERT INTO bins (bin_code, location, latitude, longitude, capacity, assigned_to, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
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

        // Create notification for assigned collector
        if (assigned_to) {
            await db.query(
                `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                 VALUES (?, ?, 'info', 'New Bin Assigned', ?)`,
                [assigned_to, result.insertId, `Bin ${bin_code} has been assigned to you at ${location}`]
            );

            // Send MQTT notification
            mqttService.publishNotification(assigned_to, {
                type: 'info',
                title: 'New Bin Assigned',
                message: `Bin ${bin_code} has been assigned to you at ${location}`,
                bin_id: result.insertId,
                timestamp: new Date()
            });
        }

        res.status(201).json({
            success: true,
            message: 'Bin created successfully',
            data: {
                id: result.insertId,
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
        const [currentBin] = await db.query('SELECT * FROM bins WHERE id = ?', [binId]);
        
        if (currentBin.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Bin not found' 
            });
        }

        // Build update query
        const updates = [];
        const params = [];

        if (location) {
            updates.push('location = ?');
            params.push(location);
        }
        if (latitude !== undefined) {
            updates.push('latitude = ?');
            params.push(latitude);
        }
        if (longitude !== undefined) {
            updates.push('longitude = ?');
            params.push(longitude);
        }
        if (capacity) {
            updates.push('capacity = ?');
            params.push(capacity);
        }
        if (assigned_to !== undefined) {
            updates.push('assigned_to = ?');
            params.push(assigned_to);
        }
        if (status) {
            updates.push('status = ?');
            params.push(status);
        }

        if (updates.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No fields to update' 
            });
        }

        params.push(binId);

        await db.query(
            `UPDATE bins SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        // If assignment changed, notify the new collector
        if (assigned_to !== undefined && assigned_to !== currentBin[0].assigned_to) {
            if (assigned_to) {
                await db.query(
                    `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                     VALUES (?, ?, 'info', 'Bin Assigned', ?)`,
                    [assigned_to, binId, `Bin ${currentBin[0].bin_code} has been assigned to you`]
                );

                mqttService.publishNotification(assigned_to, {
                    type: 'info',
                    title: 'Bin Assigned',
                    message: `Bin ${currentBin[0].bin_code} has been assigned to you`,
                    bin_id: binId,
                    timestamp: new Date()
                });
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
        const [bins] = await db.query('SELECT * FROM bins WHERE id = ?', [binId]);
        
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
        await db.query(
            'UPDATE bins SET fill_level = ?, status = ? WHERE id = ?',
            [fill_level, newStatus, binId]
        );

        // Create notification if status changed to critical or warning
        if (newStatus === 'critical' && bin.status !== 'critical') {
            const notificationMessage = `Bin ${bin.bin_code} at ${bin.location} is ${fill_level}% full and requires immediate collection`;
            
            // Notify assigned collector
            if (bin.assigned_to) {
                await db.query(
                    `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                     VALUES (?, ?, 'critical', 'Urgent Collection Required', ?)`,
                    [bin.assigned_to, binId, notificationMessage]
                );

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

            // Also notify admins
            const [admins] = await db.query('SELECT id FROM users WHERE role = "admin"');
            for (const admin of admins) {
                await db.query(
                    `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                     VALUES (?, ?, 'critical', 'Critical Bin Alert', ?)`,
                    [admin.id, binId, notificationMessage]
                );
            }
        } else if (newStatus === 'warning' && bin.status === 'normal') {
            if (bin.assigned_to) {
                const notificationMessage = `Bin ${bin.bin_code} at ${bin.location} is ${fill_level}% full`;
                
                await db.query(
                    `INSERT INTO notifications (user_id, bin_id, type, title, message) 
                     VALUES (?, ?, 'warning', 'Collection Recommended', ?)`,
                    [bin.assigned_to, binId, notificationMessage]
                );

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

        // Publish to MQTT
        mqttService.publishBinLevel(bin.bin_code, fill_level);
        mqttService.publishBinStatus(bin.bin_code, { status: newStatus, fill_level });

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
        const binId = req.params.id;
        const { notes } = req.body;

        // Get bin details
        const [bins] = await db.query('SELECT * FROM bins WHERE id = ?', [binId]);
        
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
        await db.query(
            `INSERT INTO collections (bin_id, collector_id, fill_level_before, fill_level_after, notes) 
             VALUES (?, ?, ?, 0, ?)`,
            [binId, req.user.id, fillLevelBefore, notes || null]
        );

        // Update bin status
        await db.query(
            `UPDATE bins SET fill_level = 0, status = 'normal', last_collection = NOW() WHERE id = ?`,
            [binId]
        );

        // Create success notification
        await db.query(
            `INSERT INTO notifications (user_id, bin_id, type, title, message) 
             VALUES (?, ?, 'success', 'Collection Completed', ?)`,
            [req.user.id, binId, `You successfully collected bin ${bin.bin_code}`]
        );

        // Publish to MQTT
        mqttService.publishBinLevel(bin.bin_code, 0);
        mqttService.publishBinStatus(bin.bin_code, { 
            status: 'normal', 
            fill_level: 0,
            last_collection: new Date()
        });

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

        const [bins] = await db.query('SELECT id FROM bins WHERE id = ?', [binId]);

        if (bins.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Bin not found' 
            });
        }

        await db.query('DELETE FROM bins WHERE id = ?', [binId]);

        res.json({
            success: true,
            message: 'Bin deleted successfully'
        });

    } catch (error) {
        console.error('Delete bin error:', error);
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

        const [collections] = await db.query(
            `SELECT c.*, u.name as collector_name
             FROM collections c
             JOIN users u ON c.collector_id = u.id
             WHERE c.bin_id = ?
             ORDER BY c.collection_time DESC
             LIMIT 50`,
            [binId]
        );

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