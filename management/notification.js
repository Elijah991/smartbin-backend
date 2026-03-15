const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../communication/middleware/auth');
const router = express.Router();

// Get notifications history
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { limit = 50, is_read } = req.query;
        const limitVal = parseInt(limit, 10) || 50;
        const isReadFilter = is_read == null
            ? null
            : (['1', 'true', 'yes'].includes(String(is_read).toLowerCase()));

        // Admins see all notifications; collectors see only those for bins assigned to them
        let query = `
            SELECT n.*, b.bin_code, b.location as bin_location
            FROM notifications n
            LEFT JOIN bins b ON n.bin_id = b.id
        `;

        const params = [];
        const whereClauses = [];

        if (req.user.role !== 'admin') {
            whereClauses.push(`b.assigned_to = $${params.length + 1}`);
            params.push(req.user.id);
        }

        if (isReadFilter != null) {
            whereClauses.push(`n.is_read = $${params.length + 1}`);
            params.push(isReadFilter);
        }

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        query += ` ORDER BY n.created_at DESC LIMIT $${params.length + 1}`;
        params.push(limitVal);

        const result = await db.query(query, params);
        const notifications = Array.isArray(result.rows) ? result.rows : [];

        // Provide unread count for UI
        let unreadCount = 0;
        const unreadParams = [];
        let unreadQuery = 'SELECT COUNT(*) AS unread_count FROM notifications n';
        let unreadWhere = ' WHERE n.is_read = FALSE';

        if (req.user.role !== 'admin') {
            unreadQuery += ' LEFT JOIN bins b ON n.bin_id = b.id';
            unreadWhere += ` AND b.assigned_to = $${unreadParams.length + 1}`;
            unreadParams.push(req.user.id);
        }

        const unreadResult = await db.query(unreadQuery + unreadWhere, unreadParams);
        unreadCount = Number(unreadResult.rows?.[0]?.unread_count ?? 0);

        res.json({
            success: true,
            data: notifications,
            unread_count: unreadCount,
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

        // Update notification; admins can mark any notification, collectors only their own
        const query = req.user.role === 'admin'
            ? 'UPDATE notifications SET is_read = TRUE WHERE id = $1'
            : 'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2';
        const params = req.user.role === 'admin'
            ? [notificationId]
            : [notificationId, req.user.id];

        const result = await db.query(query, params);

        if (!result || result.rowCount === 0) {
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

        const query = req.user.role === 'admin'
            ? 'DELETE FROM notifications WHERE id = $1'
            : 'DELETE FROM notifications WHERE id = $1 AND user_id = $2';
        const params = req.user.role === 'admin'
            ? [notificationId]
            : [notificationId, req.user.id];

        const result = await db.query(query, params);

        if (!result || result.rowCount === 0) {
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
        const query = req.user.role === 'admin'
            ? 'DELETE FROM notifications WHERE is_read = TRUE'
            : 'DELETE FROM notifications WHERE user_id = $1 AND is_read = TRUE';
        const params = req.user.role === 'admin' ? [] : [req.user.id];

        await db.query(query, params);

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