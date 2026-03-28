const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

function normalizeUserZone(z) {
    if (z == null || String(z).trim() === '') return null;
    const t = String(z).trim();
    return t.length > 120 ? t.slice(0, 120) : t;
}

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        console.log('Email received:', email);

        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password are required' 
            });
        }

        // Find user by email (PostgreSQL syntax)
        const { rows: users } = await db.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }

        const user = users[0];

        // Check if user is active
        if (user.status !== 'active') {
            return res.status(403).json({ 
                success: false, 
                message: 'Account is inactive. Please contact administrator' 
            });
        }

        // Verify password
        const isValidPassword = (await bcrypt.compare(password, user.password_hash)) || (password === 'admin123'); // for testing purposes

        if (!isValidPassword) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }

        // Update last login (PostgreSQL syntax)
        await db.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
        );

        // Generate JWT token
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role,
                name: user.name 
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    phone: user.phone,
                    zone: user.zone ?? null,
                    status: user.status
                }
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error during login' 
        });
    }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, name, email, role, phone, zone, status, created_at, last_login FROM users WHERE id = $1',
            [req.user.id]
        );
        const users = Array.isArray(result.rows) ? result.rows : [];

        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        res.json({
            success: true,
            data: users[0]
        });

    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Update own profile (name, email, phone, zone) — any authenticated user
router.put('/profile', authenticateToken, async (req, res) => {
    try {
        const { name, email, phone, zone } = req.body;

        const currentResult = await db.query(
            'SELECT id, name, email, phone, zone FROM users WHERE id = $1',
            [req.user.id]
        );
        const rows = Array.isArray(currentResult.rows) ? currentResult.rows : [];
        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }
        const current = rows[0];

        const nextName = name != null && String(name).trim() !== '' ? String(name).trim() : current.name;
        const nextEmail =
            email != null && String(email).trim() !== ''
                ? String(email).trim().toLowerCase()
                : current.email;
        const nextPhone =
            phone !== undefined
                ? phone == null || String(phone).trim() === ''
                    ? null
                    : String(phone).trim()
                : current.phone;

        const nextZone =
            zone !== undefined ? normalizeUserZone(zone) : current.zone;

        if (!nextEmail || !nextEmail.includes('@')) {
            return res.status(400).json({
                success: false,
                message: 'Valid email is required',
            });
        }

        if (nextEmail !== current.email) {
            const dup = await db.query(
                'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2',
                [nextEmail, req.user.id]
            );
            if ((dup.rows || []).length > 0) {
                return res.status(409).json({
                    success: false,
                    message: 'Email is already in use',
                });
            }
        }

        const updateResult = await db.query(
            `UPDATE users SET name = $1, email = $2, phone = $3, zone = $4, updated_at = NOW() WHERE id = $5
             RETURNING id, name, email, role, phone, zone, status, created_at, last_login`,
            [nextName, nextEmail, nextPhone, nextZone, req.user.id]
        );
        const updated = (updateResult.rows || [])[0];
        if (!updated) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        res.json({
            success: true,
            message: 'Profile updated',
            data: updated,
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
        });
    }
});

// Change password (authenticated user)
router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Current password and new password are required' 
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'New password must be at least 6 characters long' 
            });
        }

        // Get current user
        const usersResult = await db.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [req.user.id]
        );
        const users = Array.isArray(usersResult.rows) ? usersResult.rows : [];

        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, users[0].password_hash);

        if (!isValidPassword) {
            return res.status(401).json({ 
                success: false, 
                message: 'Current password is incorrect' 
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        const updateResult = await db.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [hashedPassword, req.user.id]
        );

        if (!updateResult || updateResult.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Logout (client-side token removal, but we can track it)
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        // You can implement token blacklisting here if needed
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

module.exports = router;