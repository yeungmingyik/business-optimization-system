import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DatabaseService } from './database.service';
import { fail, parse } from './validation';

export interface AuthUser {
  id: string;
  loginName: string;
  displayName: string;
  role: 'BOSS' | 'OPERATOR';
  accountStatus: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;
  version: number;
}
export interface AuthRequest extends Request {
  user: AuthUser;
  sessionHash: string;
  csrfToken: string;
}
export function userRow(row: any): AuthUser {
  return {
    id: row.id,
    loginName: row.login_name,
    displayName: row.display_name,
    role: row.role,
    accountStatus: row.account_status,
    mustChangePassword: row.must_change_password,
    version: row.version,
  };
}
export function boss(user: AuthUser) {
  if (user.role !== 'BOSS') fail('无操作权限', 403, 'FORBIDDEN');
}
export const passwordSchema = z
  .string()
  .min(12, '密码至少12位')
  .max(128)
  .regex(/[A-Za-z]/, '密码须包含字母')
  .regex(/\d/, '密码须包含数字');
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async getActiveUser(id: string, tx?: PoolClient) {
    const { rows } = await this.db.query(
      `SELECT * FROM users WHERE id=$1 AND account_status='ACTIVE'${tx ? ' FOR SHARE' : ''}`,
      [id],
      tx,
    );
    if (!rows[0]) fail('登录已失效', 401, 'UNAUTHORIZED');
    return userRow(rows[0]);
  }
  async hashPassword(password: string) {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  async login(input: unknown, req: Request, res: Response) {
    const data = parse(
      z.object({
        loginName: z.string().trim().min(1).max(100),
        password: z.string().min(1).max(128),
      }),
      input,
    );
    const source = req.ip ?? req.socket.remoteAddress ?? '';
    const attempts = await this.db.query(
      "SELECT count(*)::int AS count FROM login_attempts WHERE created_at>now()-interval '15 minutes' AND (login_name=$1 OR source=$2)",
      [data.loginName.toLowerCase(), source],
    );
    if (attempts.rows[0].count >= Number(process.env.BOS_LOGIN_LIMIT ?? 20))
      fail('尝试次数过多，请稍后重试', 429, 'RATE_LIMIT');
    const { rows } = await this.db.query('SELECT * FROM users WHERE lower(login_name)=lower($1)', [
      data.loginName,
    ]);
    const row = rows[0];
    const valid = row
      ? await argon2.verify(row.password_hash, data.password)
      : await argon2
          .verify(
            '$argon2id$v=19$m=19456,t=2,p=1$aHVtYW5zYWx0MTIzNDU2Nw$VNvBcoVTULNEfnCsKOJcdkglIJJL/xnqPY7/B+aGF3g',
            data.password,
          )
          .catch(() => false);
    if (!row || !valid || row.account_status !== 'ACTIVE') {
      await this.db.query('INSERT INTO login_attempts(login_name,source) VALUES($1,$2)', [
        data.loginName.toLowerCase(),
        source,
      ]);
      fail('账号或密码错误', 401, 'LOGIN_FAILED');
    }
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    await this.db.transaction(async (tx) => {
      await tx.query('DELETE FROM login_attempts WHERE login_name=$1', [
        data.loginName.toLowerCase(),
      ]);
      await tx.query('INSERT INTO sessions(token_hash,user_id,csrf_token) VALUES($1,$2,$3)', [
        digest(token),
        row.id,
        csrfToken,
      ]);
    });
    res.cookie('bos_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api',
      maxAge: 12 * 3600000,
    });
    return { user: userRow(row), csrfToken };
  }
  async authenticate(req: AuthRequest) {
    const token = req.cookies?.bos_session;
    if (typeof token !== 'string' || token.length !== 64) fail('请先登录', 401, 'UNAUTHORIZED');
    const hash = digest(token);
    const { rows } = await this.db.query(
      "SELECT u.*,s.csrf_token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.created_at>now()-($2::int*interval '1 minute') AND s.last_seen_at>now()-($3::int*interval '1 minute') AND u.account_status='ACTIVE'",
      [
        hash,
        Number(process.env.BOS_SESSION_ABSOLUTE_MINUTES ?? 720),
        Number(process.env.BOS_SESSION_IDLE_MINUTES ?? 30),
      ],
    );
    if (!rows[0]) fail('登录已失效', 401, 'UNAUTHORIZED');
    req.user = userRow(rows[0]);
    req.sessionHash = hash;
    req.csrfToken = rows[0].csrf_token;
    await this.db.query('UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1', [hash]);
    return req.user;
  }
  async logout(req: AuthRequest, res: Response) {
    await this.db.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1', [
      req.sessionHash,
    ]);
    res.clearCookie('bos_session', { path: '/api' });
    return { ok: true };
  }
  async changePassword(user: AuthUser, input: unknown) {
    const data = parse(
      z.object({ currentPassword: z.string().max(128), newPassword: passwordSchema }),
      input,
    );
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [
        user.id,
      ]);
      if (!(await argon2.verify(rows[0].password_hash, data.currentPassword))) fail('当前密码错误');
      if (data.currentPassword === data.newPassword) fail('新密码不能与原密码相同');
      await tx.query(
        'UPDATE users SET password_hash=$2,must_change_password=false,version=version+1,updated_at=now() WHERE id=$1',
        [user.id, await this.hashPassword(data.newPassword)],
      );
      await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1', [user.id]);
      return { ok: true };
    });
  }
  async initialize() {
    const password = parse(passwordSchema, process.env.BOS_ADMIN_PASSWORD);
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(739202)');
      if ((await tx.query('SELECT id FROM users LIMIT 1')).rowCount) return false;
      await tx.query(
        "INSERT INTO users(id,login_name,display_name,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,'BOSS',false)",
        [
          randomUUID(),
          process.env.BOS_ADMIN_LOGIN ?? 'admin',
          process.env.BOS_ADMIN_NAME ?? '企业老板',
          await this.hashPassword(password),
        ],
      );
      return true;
    });
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const path = req.path.replace(/\/$/, '');
    if (path === '/api/v1/health') return true;
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (write) {
      const origin = req.headers.origin;
      const allowed = (
        process.env.BOS_ALLOWED_ORIGINS ??
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000'
      ).split(',');
      if (origin && !allowed.includes(origin)) fail('请求来源无效', 403, 'ORIGIN_INVALID');
      if (req.headers['sec-fetch-site'] === 'cross-site')
        fail('请求来源无效', 403, 'ORIGIN_INVALID');
    }
    if (path === '/api/v1/auth/login' && req.method === 'POST') return true;
    await this.auth.authenticate(req);
    if (
      req.user.mustChangePassword &&
      !['/api/v1/auth/me', '/api/v1/auth/change-password', '/api/v1/auth/logout'].includes(path)
    )
      fail('请先修改密码', 403, 'PASSWORD_CHANGE_REQUIRED');
    if (write) {
      const token = req.headers['x-csrf-token'];
      if (
        typeof token !== 'string' ||
        token.length !== req.csrfToken.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(req.csrfToken))
      )
        fail('请求校验失效，请刷新后重试', 403, 'CSRF_INVALID');
    }
    return true;
  }
}
