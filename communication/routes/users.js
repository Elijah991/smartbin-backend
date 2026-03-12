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
        const [existingUsers] = await db.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({ 
                success: false, 
                message: 'Email already exists' 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const [result] = await db.query(
            'INSERT INTO users (name, email, password_hash, role, phone, status) VALUES (?, ?, ?, ?, ?, ?)',
            [name, email, hashedPassword, role || 'collector', phone || null, 'active']
        );

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: {
                id: result.insertId,
                name,
                email,
                role: role || 'collector',
                phone
            }
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Update user (Admin only)
router.put('/:id', authenticateToken, authorizeRole('admin'), async (req, res) => {
    try {
        const { name, email, phone, role, status } = req.body;
        const userId = req.params.id;

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (name) {
            updates.push('name = ?');
            params.push(name);
        }
        if (email) {
            updates.push('email = ?');
            params.push(email);
        }
        if (phone !== undefined) {
            updates.push('phone = ?');
            params.push(phone);
        }
        if (role) {
            updates.push('role = ?');
            params.push(role);
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

        params.push(userId);

        await db.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

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
});

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
        await db.query(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [hashedPassword, userId]
        );

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
        const [users] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);

        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Prevent admin from deleting themselves
        if (parseInt(userId) === req.user.id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete your own account' 
            });
        }

        // Delete user (cascades to related records)
        await db.query('DELETE FROM users WHERE id = ?', [userId]);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('Delete user error:', error);
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
        if (req.user.role !== 'admin' && parseInt(userId) !== req.user.id) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied' 
            });
        }

        const [collections] = await db.query(
            `SELECT c.*, b.bin_code, b.location
             FROM collections c
             JOIN bins b ON c.bin_id = b.id
             WHERE c.collector_id = ?
             ORDER BY c.collection_time DESC
             LIMIT 50`,
            [userId]
        );

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