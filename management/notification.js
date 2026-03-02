const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../communication/middleware/auth');
const router = express.Router();

// Get user notifications
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { is_read, type, limit = 50 } = req.query;
        
        let query = `
            SELECT n.*, b.bin_code, b.location as bin_location
            FROM notifications n
            LEFT JOIN bins b ON n.bin_id = b.id
            WHERE (n.user_id = ? OR n.user_id IS NULL)
        `;
        const params = [req.user.id];

        if (is_read !== undefined) {
            query += ' AND n.is_read = ?';
            params.push(is_read === 'true' ? 1 : 0);
        }

        if (type) {
            query += ' AND n.type = ?';
            params.push(type);
        }

        query += ' ORDER BY n.created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        const [notifications] = await db.query(query, params);

        // Get unread count
        const [unreadCount] = await db.query(
            'SELECT COUNT(*) as count FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND is_read = FALSE',
            [req.user.id]
        );

        res.json({
            success: true,
            data: notifications,
            unread_count: unreadCount[0].count
        });

    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Mark notification as read
router.patch('/:id/read', authenticateToken, async (req, res) => {
    try {
        const notificationId = req.params.id;

        // Update notification
        const [result] = await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
            [notificationId, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Notification not found' 
            });
        }

        res.json({
            success: true,
            message: 'Notification marked as read'
        });

    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Mark all notifications as read
router.post('/mark-all-read', authenticateToken, async (req, res) => {
    try {
        await db.query(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
            [req.user.id]
        );

        res.json({
            success: true,
            message: 'All notifications marked as read'
        });

    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Delete notification
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const notificationId = req.params.id;

        const [result] = await db.query(
            'DELETE FROM notifications WHERE id = ? AND user_id = ?',
            [notificationId, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Notification not found' 
            });
        }

        res.json({
            success: true,
            message: 'Notification deleted'
        });

    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Clear all read notifications
router.delete('/clear-read', authenticateToken, async (req, res) => {
    try {
        await db.query(
            'DELETE FROM notifications WHERE user_id = ? AND is_read = TRUE',
            [req.user.id]
        );

        res.json({
            success: true,
            message: 'Read notifications cleared'
        });

    } catch (error) {
        console.error('Clear read notifications error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

module.exports = router;