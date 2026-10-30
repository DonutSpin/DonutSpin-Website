import { Router } from 'express';
import type { DB } from '../db/index.ts';
import type { StaffMember } from '../../shared/types.ts';
import { forbidden } from '../lib/core.ts';
import { can, requireAuth, requirePermission } from '../lib/permissions.ts';
import { buildTicketList, ticketCounts } from '../lib/tickets.ts';

interface WorkloadRow {
  id: string;
  username: string;
  email: string;
  role: StaffMember['role'];
  status: StaffMember['status'];
  assigned_open: number;
  assigned_total: number;
  last_seen_at: string | null;
  created_at: string;
}

export function staffWorkload(db: DB): StaffMember[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.last_seen_at, u.created_at,
              (SELECT COUNT(*) FROM tickets t WHERE t.assignee_id = u.id AND t.status NOT IN ('closed','rejected')) AS assigned_open,
              (SELECT COUNT(*) FROM tickets t WHERE t.assignee_id = u.id) AS assigned_total
       FROM users u
       WHERE u.role <> 'user'
       ORDER BY assigned_open DESC, u.username ASC`,
    )
    .all() as WorkloadRow[];
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    assignedOpen: row.assigned_open,
    assignedTotal: row.assigned_total,
    lastActivityAt: row.last_seen_at,
    createdAt: row.created_at,
  }));
}

export function createStaffRouter(db: DB): Router {
  const router = Router();

  router.get('/overview', (req, res) => {
    const user = requirePermission(req, 'staff.access');
    const counts = ticketCounts(db, user);
    const assigned = buildTicketList(db, user, { scope: 'mine', page: 1, pageSize: 8, sort: 'activity' }).items;
    const unassigned = buildTicketList(db, user, { scope: 'unassigned', page: 1, pageSize: 5, sort: 'activity' }).items;
    const recentEvents = db
      .prepare(
        `SELECT e.id, e.type, e.from_value, e.to_value, e.note, e.created_at,
                t.reference AS ticket_reference, t.subject AS ticket_subject
         FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id
         WHERE e.actor_id = ? ORDER BY e.created_at DESC LIMIT 12`,
      )
      .all(user.id) as {
      id: string;
      type: string;
      from_value: string | null;
      to_value: string | null;
      note: string | null;
      created_at: string;
      ticket_reference: string;
      ticket_subject: string;
    }[];
    const handled = db
      .prepare(
        `SELECT COUNT(*) AS count FROM tickets
         WHERE assignee_id = ? AND status IN ('resolved','closed') AND last_activity_at >= ?`,
      )
      .get(user.id, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) as { count: number };
    res.json({
      counts,
      assignedTickets: assigned,
      unassignedTickets: unassigned,
      recentEvents: recentEvents.map((row) => ({
        id: row.id,
        type: row.type,
        from: row.from_value,
        to: row.to_value,
        note: row.note,
        createdAt: row.created_at,
        ticketReference: row.ticket_reference,
        ticketSubject: row.ticket_subject,
      })),
      resolvedLast7Days: handled.count,
      workload: staffWorkload(db),
    });
  });

  router.get('/team', (req, res) => {
    const user = requireAuth(req);
    if (!can(user.role, 'users.read') && !can(user.role, 'tickets.assign')) {
      throw forbidden('You cannot view the staff roster.');
    }
    res.json({ staff: staffWorkload(db) });
  });

  router.get('/activity', (req, res) => {
    const user = requirePermission(req, 'staff.access');
    const rows = db
      .prepare(
        `SELECT e.id, e.type, e.from_value, e.to_value, e.note, e.created_at,
                t.reference AS ticket_reference, t.subject AS ticket_subject
         FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id
         WHERE e.actor_id = ? ORDER BY e.created_at DESC LIMIT 100`,
      )
      .all(user.id) as {
      id: string;
      type: string;
      from_value: string | null;
      to_value: string | null;
      note: string | null;
      created_at: string;
      ticket_reference: string;
      ticket_subject: string;
    }[];
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        from: row.from_value,
        to: row.to_value,
        note: row.note,
        createdAt: row.created_at,
        ticketReference: row.ticket_reference,
        ticketSubject: row.ticket_subject,
      })),
    });
  });

  return router;
}
