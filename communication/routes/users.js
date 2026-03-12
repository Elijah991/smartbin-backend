const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

// Get all users/collectors (Admin only)
router.get('/', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { role, status } = req.query;
        
        let query = `
            SELECT u.id, u.name, u.email, u.role, u.phone, u.status, 
                   u.created_at, u.last_login,
                   COUNT(DISTINCT b.id) AS assigned_bins,
                   COUNT(DISTINCT c.id) AS total_collections
            FROM users u
            LEFT JOIN bins b ON u.id = b.assigned_to
            LEFT JOIN collections c ON u.id = c.collector_id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (role) {
            query += ` AND u.role = $${paramIndex++}`;
            params.push(role);
        }

        if (status) {
            query += ` AND u.status = $${paramIndex++}`;
            params.push(status);
        }

        query += `
            GROUP BY 
                u.id, u.name, u.email, u.role, u.phone, u.status, 
                u.created_at, u.last_login
            ORDER BY u.created_at DESC
        `;

        const result = await db.query(query, params);
        const users = Array.isArray(result.rows) ? result.rows : [];

        res.json({
            success: true,
            data: users
        });

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Get single user by ID (Admin only)
router.get('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const userId = req.params.id;

        const result = await db.query(
            `SELECT id, name, email, role, phone, status, created_at, last_login
             FROM users
             WHERE id = $1`,
            [userId]
        );

        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Create new user (Admin only)
router.post('/', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { name, email, password, role, phone } = req.body;

        // Validation
        if (!name || !email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Name, email, and password are required' 
            });
        }

        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 6 characters long' 
            });
        }

        // Check if email already exists
        const existingUsersResult = await db.query(
            'SELECT id FROM users WHERE email = $1',
            [email]
        );
        const existingUsers = existingUsersResult.rows || [];

        if (existingUsers.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: 'Email already exists' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const insertQuery = `
            INSERT INTO users (name, email, password_hash, role, phone, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, name, email, role, phone
        `;
        console.log('Create user insert query:', insertQuery.trim(), 'params:', [
            name,
            email,
            hashedPassword,
            role || 'collector',
            phone || null,
            'active'
        ]);
        const insertResult = await db.query(insertQuery, [
            name,
            email,
            hashedPassword,
            role || 'collector',
            phone || null,
            'active'
        ]);
        const newUser = insertResult.rows[0];

        console.log('User created successfully, sending response...', newUser);

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: newUser
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

const updateUserHandler = async (req, res) => {
    try {
        const { name, email, phone, role, status } = req.body;
        const userId = req.params.id;

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (name) {
            params.push(name);
            updates.push(`name = $${params.length}`);
        }
        if (email) {
            params.push(email);
            updates.push(`email = $${params.length}`);
        }
        if (phone !== undefined) {
            params.push(phone);
            updates.push(`phone = $${params.length}`);
        }
        if (role) {
            params.push(role);
            updates.push(`role = $${params.length}`);
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

        params.push(userId);
        const idParamIndex = params.length;

        const updateQuery = `UPDATE users SET ${updates.join(', ')} WHERE id = $${idParamIndex}`;
        console.log('Update user query:', updateQuery, 'params:', params);
        const result = await db.query(updateQuery, params);

        if (!result || result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found or not updated'
            });
        }

        res.json({
            success: true,
            message: 'User updated successfully'
        });

    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
};

// Update user (Admin only) - PUT (full) and PATCH (partial/status)
router.put('/:id', authenticateToken, authorizeRole('admin'), updateUserHandler);
router.patch('/:id', authenticateToken, authorizeRole('admin'), updateUserHandler);

// Reset user password (Admin only)
router.post('/:id/reset-password', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { newPassword } = req.body;
        const userId = req.params.id;

        if (!newPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'New password is required' 
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 6 characters long' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        const resetQuery = 'UPDATE users SET password_hash = $1 WHERE id = $2';
        console.log('Reset password query:', resetQuery, 'params:', [hashedPassword, userId]);
        const result = await db.query(resetQuery, [hashedPassword, userId]);

        if (!result || result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found or password not updated'
            });
        }

        res.json({
            success: true,
            message: 'Password reset successfully'
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Delete user (Admin only)
router.delete('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const userId = req.params.id;

        // Check if user exists
        const checkQuery = 'SELECT id FROM users WHERE id = $1';
        console.log('Delete user check query:', checkQuery, 'params:', [userId]);
        const usersResult = await db.query(checkQuery, [userId]);
        const users = usersResult.rows || [];

        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Prevent admin from deleting themselves
        if (parseInt(userId, 10) === req.user.id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete your own account' 
            });
        }

        // Delete user (cascades to related records)
        const deleteQuery = 'DELETE FROM users WHERE id = $1';
        console.log('Delete user query:', deleteQuery, 'params:', [userId]);
        const deleteResult = await db.query(deleteQuery, [userId]);

        if (!deleteResult || deleteResult.rowCount === 0) {
            return res.status(400).json({
                success: false,
                message: 'User could not be deleted'
            });
        }

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('Delete user error:', error);

        if (error.code === '23503') {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete user because there are related records (e.g. bins or collections)'
            });
        }

        res.status(500).json({ 
            success: false,
            message: 'Server error' 
        });
    }
});

// Get user's collection history
router.get('/:id/collections', authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;

        // Admin can view any user's history, collectors can only view their own
        if (req.user.role !== 'admin' && parseInt(userId, 10) !== req.user.id) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied' 
            });
        }

        const historyQuery = `
            SELECT c.*, b.bin_code, b.location
            FROM collections c
            JOIN bins b ON c.bin_id = b.id
            WHERE c.collector_id = $1
            ORDER BY c.collection_time DESC
            LIMIT 50
        `;
        console.log('Get user collections query:', historyQuery.trim(), 'params:', [userId]);
        const collectionsResult = await db.query(historyQuery, [userId]);
        const collections = Array.isArray(collectionsResult.rows)
            ? collectionsResult.rows
            : [];

        res.json({
            success: true,
            data: collections
        });

    } catch (error) {
        console.error('Get collections error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

module.exports = router;