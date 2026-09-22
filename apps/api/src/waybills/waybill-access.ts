import type { PoolClient } from 'pg';
import type { AuthUser } from '../auth.service';
import { fail } from '../validation';

export async function syncOrderWaybills(
  tx: PoolClient,
  user: AuthUser,
  orderId: string,
  shipments: Array<{ attachmentIds?: string[] }>,
) {
  const ids = shipments.flatMap((shipment) => shipment.attachmentIds ?? []);
  if (ids.length > 100 || new Set(ids).size !== ids.length) fail('运单附件不能重复');
  const { rows } = await tx.query(
    `SELECT *,created_at>now()-interval '24 hours' AS unexpired FROM waybill_attachments
     WHERE id=ANY($1::uuid[]) OR order_id=$2 ORDER BY id FOR UPDATE`,
    [ids, orderId],
  );
  for (const id of ids) {
    const row = rows.find((item) => item.id === id);
    if (
      !row ||
      row.deleted_at ||
      (row.order_id !== orderId && (row.order_id || row.uploader_id !== user.id || !row.unexpired))
    )
      fail('运单附件不可用', 404, 'NOT_FOUND');
  }
  await tx.query('UPDATE waybill_attachments SET order_id=$2 WHERE id=ANY($1::uuid[])', [
    ids,
    orderId,
  ]);
  await tx.query(
    'UPDATE waybill_attachments SET deleted_at=now() WHERE order_id=$1 AND NOT(id=ANY($2::uuid[])) AND deleted_at IS NULL',
    [orderId, ids],
  );
}
