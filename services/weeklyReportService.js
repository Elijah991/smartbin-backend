const PDFDocument = require('pdfkit');

const KG_PER_FILL_POINT = 0.5;

/**
 * @param {import('pg').Pool | { query: Function }} db
 */
async function fetchWeeklyReportData(db) {
    const weekActivityQuery = `
        SELECT
            DATE_TRUNC('day', c.collection_time)::date AS day,
            COUNT(c.id)::int AS collection_count,
            COALESCE(SUM(c.fill_level_before), 0)::float8 AS total_fill_cleared
        FROM collections c
        WHERE c.collection_time >= NOW() - INTERVAL '7 days'
        GROUP BY DATE_TRUNC('day', c.collection_time)
        ORDER BY day ASC
    `;

    const leaderboardWeekQuery = `
        SELECT
            u.name AS name,
            COUNT(c.id)::int AS collection_count
        FROM collections c
        INNER JOIN users u ON c.collector_id = u.id
        WHERE c.collection_time >= NOW() - INTERVAL '7 days'
        GROUP BY u.id, u.name
        ORDER BY collection_count DESC
        LIMIT 3
    `;

    const weekTotalsQuery = `
        SELECT
            COUNT(*)::int AS total_collections,
            COALESCE(SUM(fill_level_before), 0)::float8 AS total_fill
        FROM collections
        WHERE collection_time >= NOW() - INTERVAL '7 days'
    `;

    const lifetimeQuery = `
        SELECT COALESCE(SUM(fill_level_before), 0)::float8 AS lifetime_fill_sum
        FROM collections
    `;

    const [activityRes, boardRes, totalsRes, lifeRes] = await Promise.all([
        db.query(weekActivityQuery),
        db.query(leaderboardWeekQuery),
        db.query(weekTotalsQuery),
        db.query(lifetimeQuery),
    ]);

    const activityRows = Array.isArray(activityRes.rows) ? activityRes.rows : [];
    const boardRows = Array.isArray(boardRes.rows) ? boardRes.rows : [];
    const totalsRow = totalsRes.rows?.[0] || { total_collections: 0, total_fill: 0 };
    const lifeRow = lifeRes.rows?.[0] || { lifetime_fill_sum: 0 };

    const weekCollections = Number(totalsRow.total_collections || 0);
    const weekFill = Number(totalsRow.total_fill || 0);
    const weekTotalKg = Math.round(weekFill * KG_PER_FILL_POINT * 100) / 100;
    const lifetimeKg =
        Math.round(Number(lifeRow.lifetime_fill_sum || 0) * KG_PER_FILL_POINT * 100) / 100;

    const byKey = {};
    for (const r of activityRows) {
        const key =
            r.day instanceof Date
                ? r.day.toISOString().slice(0, 10)
                : String(r.day).slice(0, 10);
        byKey[key] = {
            collection_count: Number(r.collection_count || 0),
            total_fill_cleared: Number(r.total_fill_cleared || 0),
        };
    }

    const sevenDayRows = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - (6 - i));
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dayNum = String(d.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${dayNum}`;
        const data = byKey[key] || { collection_count: 0, total_fill_cleared: 0 };
        const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
        const estKg =
            Math.round(data.total_fill_cleared * KG_PER_FILL_POINT * 100) / 100;
        sevenDayRows.push({
            date: key,
            weekday,
            collection_count: data.collection_count,
            total_fill_cleared: data.total_fill_cleared,
            est_kg: estKg,
        });
    }

    let peakDayLabel = '—';
    let peakFill = -1;
    for (const row of sevenDayRows) {
        if (row.total_fill_cleared > peakFill) {
            peakFill = row.total_fill_cleared;
            peakDayLabel = row.weekday;
        }
    }
    if (peakFill <= 0 && weekCollections === 0) {
        peakDayLabel = 'No activity';
    }

    const topCollectors = boardRows.map((r) => ({
        name: r.name,
        collection_count: Number(r.collection_count || 0),
    }));

    return {
        generatedAt: new Date().toISOString(),
        sevenDayRows,
        weekTotalKg,
        weekCollections,
        peakDayLabel,
        topCollectors,
        lifetimeEstimatedKg: lifetimeKg,
    };
}

/**
 * @param {import('express').Response} res
 * @param {Awaited<ReturnType<typeof fetchWeeklyReportData>>} data
 */
function streamWeeklyReportPdf(res, data) {
    const {
        generatedAt,
        sevenDayRows,
        weekTotalKg,
        weekCollections,
        peakDayLabel,
        topCollectors,
        lifetimeEstimatedKg,
    } = data;

    const generatedDisplay = new Date(generatedAt).toLocaleString('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
        'Content-Disposition',
        'attachment; filename="SmartBin-Weekly-Report.pdf"'
    );

    const doc = new PDFDocument({
        margin: 48,
        size: 'LETTER',
        info: {
            Title: 'SmartBin Weekly Report',
            Author: 'SmartBin',
        },
    });

    doc.pipe(res);

    const lightGreen = '#4CAF50';
    doc.rect(0, 0, doc.page.width, 72).fill(lightGreen);
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold');
    doc.text('SmartBin', 48, 18);
    doc.fontSize(10).font('Helvetica');
    doc.text('Waste operations & analytics', 48, 44);

    doc.fillColor('#212121');
    let y = 96;
    const contentW = doc.page.width - 96;

    doc.fontSize(20).font('Helvetica-Bold').text('Weekly Operations Report', 48, y);
    y = doc.y + 8;
    doc.fontSize(10).font('Helvetica').fillColor('#616161');
    doc.text(`Report generated: ${generatedDisplay}`, 48, y, { width: contentW });
    doc.fillColor('#212121');
    y = doc.y + 24;

    doc.fontSize(13).font('Helvetica-Bold').text('Performance Summary', 48, y);
    y = doc.y + 6;
    const summaryText =
        `This week, the system managed ${weekTotalKg.toLocaleString(undefined, {
            maximumFractionDigits: 1,
        })} kg across ${weekCollections} collection${weekCollections === 1 ? '' : 's'}. ` +
        `Peak day by cleared fill index was ${peakDayLabel}. ` +
        `All-time estimated waste managed is approximately ${lifetimeEstimatedKg.toLocaleString(
            undefined,
            { maximumFractionDigits: 1 }
        )} kg (using ${KG_PER_FILL_POINT} kg per fill index point).`;

    doc.fontSize(11).font('Helvetica').text(summaryText, 48, y, {
        width: contentW,
        align: 'left',
    });
    y = doc.y + 28;

    doc.fontSize(13).font('Helvetica-Bold').text('Collector leaderboard (this week)', 48, y);
    y = doc.y + 10;
    if (topCollectors.length === 0) {
        doc.fontSize(10).font('Helvetica').fillColor('#757575');
        doc.text('No collections recorded in the last 7 days.', 48, y);
        doc.fillColor('#212121');
        y = doc.y + 16;
    } else {
        topCollectors.forEach((c, i) => {
            const line = `${i + 1}. ${c.name} — ${c.collection_count} collection${
                c.collection_count === 1 ? '' : 's'
            }`;
            doc.fontSize(11).font('Helvetica').text(line, 48, y, { width: contentW });
            y = doc.y + 2;
        });
        y += 12;
    }

    doc.fontSize(13).font('Helvetica-Bold').text('Last 7 days — daily activity', 48, y);
    y = doc.y + 14;

    const colDate = 48;
    const colDay = 130;
    const colColl = 230;
    const colFill = 320;
    const colKg = 400;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#424242');
    doc.text('Date', colDate, y);
    doc.text('Day', colDay, y);
    doc.text('Collections', colColl, y);
    doc.text('Fill Σ', colFill, y);
    doc.text('Est. kg', colKg, y);
    y += 14;
    doc.moveTo(48, y).lineTo(doc.page.width - 48, y).stroke('#BDBDBD');
    y += 8;

    doc.font('Helvetica').fillColor('#212121');
    for (const row of sevenDayRows) {
        doc.fontSize(9);
        doc.text(row.date, colDate, y);
        doc.text(row.weekday.slice(0, 3), colDay, y);
        doc.text(String(row.collection_count), colColl, y);
        doc.text(row.total_fill_cleared.toFixed(0), colFill, y);
        doc.text(row.est_kg.toFixed(1), colKg, y);
        y += 16;
    }

    y += 16;
    doc.fontSize(9).fillColor('#757575').font('Helvetica');
    doc.text(
        'Fill Σ = sum of fill_level_before cleared that day. Est. kg = Fill Σ × 0.5.',
        48,
        y,
        { width: contentW }
    );

    doc.end();
}

module.exports = {
    KG_PER_FILL_POINT,
    fetchWeeklyReportData,
    streamWeeklyReportPdf,
};
