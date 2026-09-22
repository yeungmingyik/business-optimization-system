import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { unlink } from 'node:fs/promises';
import type { AuthUser } from '../auth.service';
import { DatabaseService } from '../database.service';
import { storagePath } from '../transfer/storage';
import { fail, parse } from '../validation';
import { z } from 'zod';
import { inspectWaybillImage } from './waybill-image';

@Injectable()
export class WaybillService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: NodeJS.Timeout;
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  onModuleInit() {
    void this.cleanup().catch(() => undefined);
    this.cleanupTimer = setInterval(() => void this.cleanup().catch(() => undefined), 3600000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  async cleanup() {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id,storage_key FROM waybill_attachments WHERE deleted_at IS NOT NULL OR
        (order_id IS NULL AND created_at<now()-interval '24 hours') LIMIT 100 FOR UPDATE SKIP LOCKED`,
      );
      for (const row of rows) {
        await unlink(storagePath(row.storage_key)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
        await tx.query('DELETE FROM waybill_attachments WHERE id=$1', [row.id]);
      }
    });
  }

  private metadata(row: any) {
    return {
      id: row.id,
      name: row.original_name,
      mediaType: row.media_type,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      pending: !row.order_id,
    };
  }

  async upload(user: AuthUser, file?: Express.Multer.File) {
    if (!file) fail('请选择运单图片');
    try {
      const image = await inspectWaybillImage(file);
      const nameBytes = Buffer.from(file.originalname, 'latin1');
      const name =
        !/[^\u0000-\u00ff]/.test(file.originalname) && isUtf8(nameBytes)
          ? nameBytes.toString('utf8')
          : file.originalname;
      return await this.db.transaction(async (tx) => {
        const active = await tx.query(
          'SELECT account_status,must_change_password FROM users WHERE id=$1 FOR UPDATE',
          [user.id],
        );
        if (active.rows[0]?.account_status !== 'ACTIVE' || active.rows[0]?.must_change_password)
          fail('登录已失效', 401, 'UNAUTHORIZED');
        const count = await tx.query(
          `SELECT count(*)::int AS count FROM waybill_attachments WHERE uploader_id=$1
          AND order_id IS NULL AND deleted_at IS NULL AND created_at>now()-interval '24 hours'`,
          [user.id],
        );
        if (count.rows[0].count >= 30) fail('待保存的运单图片过多，请先保存订单或移除图片');
        const { rows } = await tx.query(
          `INSERT INTO waybill_attachments(id,uploader_id,storage_key,original_name,media_type,bytes,width,height)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            randomUUID(),
            user.id,
            file.filename,
            name.replace(/[\x00-\x1f\x7f\\/]/g, '_').slice(0, 200),
            image.mediaType,
            image.bytes,
            image.width,
            image.height,
          ],
        );
        return this.metadata(rows[0]);
      });
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      if (error instanceof Error && !('getStatus' in error)) fail(error.message);
      throw error;
    }
  }

  async accessible(user: AuthUser, id: string) {
    parse(z.string().uuid(), id);
    const { rows } = await this.db.query(
      `SELECT a.* FROM waybill_attachments a LEFT JOIN orders o ON o.id=a.order_id
      LEFT JOIN customers c ON c.id=o.customer_id WHERE a.id=$1 AND a.deleted_at IS NULL AND
      ((a.order_id IS NULL AND a.uploader_id=$2 AND a.created_at>now()-interval '24 hours') OR
      (a.order_id IS NOT NULL AND ($3='BOSS' OR c.owner_id=$2)))`,
      [id, user.id, user.role],
    );
    if (!rows[0]) fail('运单附件不可用', 404, 'NOT_FOUND');
    return rows[0];
  }

  async get(user: AuthUser, id: string) {
    return this.metadata(await this.accessible(user, id));
  }

  async remove(user: AuthUser, id: string) {
    parse(z.string().uuid(), id);
    const result = await this.db.query(
      'UPDATE waybill_attachments SET deleted_at=now() WHERE id=$1 AND uploader_id=$2 AND order_id IS NULL AND deleted_at IS NULL RETURNING id',
      [id, user.id],
    );
    if (!result.rowCount) fail('运单附件不可用', 404, 'NOT_FOUND');
    void this.cleanup().catch(() => undefined);
    return { ok: true };
  }
}
