import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertNotLegacy, ConfigError, loadConfig, loadDotEnv, profileConfig } from '../config.ts';
import { openServerDb, type User, Users } from '../users.ts';
import { backupUser } from './backup.ts';
import { migrateLibrary } from './migrate.ts';
import { ago, duration, folderMb, recentJobs, userStats } from './stats.ts';

const USAGE = `Usage: pnpm users <command>
  add <id> [--name "Full Name"]   make an account and print its invite link
  list                            who is on the server and how they are doing
  show <id>                       one user in detail
  jobs <id> [--limit N] [--failed]  their recent jobs
  reset <id>                      new token (the old one stops working) and a new invite link
  disable <id> | enable <id>      turn an account off or on
  backup <id> | --all             tar.gz of their folder in $STUDYO_BACKUP_DIR (default ~/Backups/studyo)
  migrate --id <id> [--name N]    one-time: move the single-user library to users/<id>/ (server stopped)`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function table(rows: string[][]) {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  for (const r of rows)
    console.log(
      r
        .map((c, i) => c.padEnd(widths[i]!))
        .join('  ')
        .trimEnd(),
    );
}

function inviteLink(token: string): string {
  const app = process.env.STUDYO_INVITE_APP ?? 'https://studyo.ilesan.me';
  const server = process.env.STUDYO_INVITE_SERVER ?? 'https://studyo-api.ilesan.me';
  return `${app}/connect?server=${encodeURIComponent(server)}&token=${encodeURIComponent(token)}`;
}

async function serverRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  loadDotEnv();
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }
  const config = loadConfig();
  if (command === 'migrate') {
    const id = flag(args, 'id');
    if (!id) throw new Error('migrate needs --id <your user id>.');
    const result = await migrateLibrary(config, {
      id,
      name: flag(args, 'name'),
      serverRunning: () => serverRunning(config.port),
      log: (l) => console.log(l),
    });
    console.log(
      `\nMoved ${result.movedLibrary.length} library entries and ${result.movedState.length} state entries to users/${id}/.`,
    );
    console.log(`Backup: ${result.backup}`);
    if (result.activeJobs)
      console.log(
        `${result.activeJobs} job(s) were active; running ones fail on the next start, queued ones carry on.`,
      );
    console.log(
      'Your existing token still works. Start the server: launchctl kickstart -k gui/$(id -u)/com.studyo.server',
    );
    return;
  }

  assertNotLegacy(config);
  const db = openServerDb(config.stateDir);
  const users = new Users(db);
  const need = (id: string | undefined): User => {
    const user = id ? users.get(id) : null;
    if (!user) throw new Error(`There is no user "${id ?? ''}". Try: pnpm users list`);
    return user;
  };

  switch (command) {
    case 'add': {
      const id = args[0];
      if (!id) throw new Error('add needs an id, e.g. pnpm users add alice --name "Alice"');
      const { user, token } = users.create({ id, name: flag(args, 'name') });
      profileConfig(config, user);
      // New people use the owner's AI settings (CLI and model).
      const owner = users.list().find((u) => u.admin);
      const from = owner ? join(config.usersDir, owner.id, '_studyo', 'settings.json') : null;
      if (from && existsSync(from)) {
        mkdirSync(join(config.usersDir, id, '_studyo'), { recursive: true });
        copyFileSync(from, join(config.usersDir, id, '_studyo', 'settings.json'));
      }
      console.log(
        `Created ${user.id} (${user.name}).\nToken (shown once): ${token}\nInvite link: ${inviteLink(token)}`,
      );
      break;
    }
    case 'list': {
      const rows = [
        ['id', 'name', 'status', 'last seen', 'jobs 7d (ok/failed)', 'active', 'topics', 'MB'],
      ];
      for (const u of users.list()) {
        const st = userStats(config.usersDir, u.id);
        rows.push([
          u.id + (u.admin ? '*' : ''),
          u.name,
          u.disabled ? 'disabled' : 'active',
          ago(u.last_seen),
          `${st.ok7}/${st.failed7}`,
          String(st.active),
          String(st.topics + st.courses),
          String(folderMb(join(config.usersDir, u.id))),
        ]);
      }
      table(rows);
      console.log('* = admin');
      break;
    }
    case 'show': {
      const u = need(args[0]);
      const st = userStats(config.usersDir, u.id);
      console.log(
        `${u.id} (${u.name})${u.admin ? ' [admin]' : ''}${u.disabled ? ' [disabled]' : ''}`,
      );
      console.log(`created ${u.created}, last seen ${ago(u.last_seen)}`);
      console.log(
        `folder ${join(config.usersDir, u.id)} (${folderMb(join(config.usersDir, u.id))} MB)`,
      );
      console.log(
        `${st.topics} topics, ${st.courses} courses, ${st.ok7} ok / ${st.failed7} failed jobs in 7 days, ${st.active} active`,
      );
      for (const j of recentJobs(config.usersDir, u.id, 5, false))
        console.log(
          `  ${j.created.slice(0, 16)}  ${j.kind.padEnd(14)} ${j.status.padEnd(10)} ${j.topic_id}`,
        );
      break;
    }
    case 'jobs': {
      const u = need(args[0]);
      const limit = Number(flag(args, 'limit') ?? 20);
      const rows = [['created', 'kind', 'status', 'took', 'topic', 'error']];
      for (const j of recentJobs(config.usersDir, u.id, limit, args.includes('--failed')))
        rows.push([
          j.created.slice(0, 16).replace('T', ' '),
          j.kind,
          j.status,
          duration(j),
          j.topic_id,
          (j.error ?? '').slice(0, 100),
        ]);
      table(rows);
      break;
    }
    case 'reset': {
      const { user, token } = users.resetToken(need(args[0]).id);
      console.log(
        `New token for ${user.id} (shown once): ${token}\nInvite link: ${inviteLink(token)}`,
      );
      break;
    }
    case 'disable':
    case 'enable': {
      const u = users.setDisabled(need(args[0]).id, command === 'disable');
      console.log(`${u.id} is now ${u.disabled ? 'disabled' : 'active'}.`);
      break;
    }
    case 'backup': {
      const ids = args.includes('--all') ? users.list().map((u) => u.id) : [need(args[0]).id];
      for (const id of ids) {
        const r = backupUser(config.usersDir, config.backupDir, id);
        console.log(`${id}: ${r.file} (${(r.bytes / 1048576).toFixed(1)} MB)`);
      }
      break;
    }
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
  db.close();
}

main().catch((e) => {
  console.error(e instanceof ConfigError || e instanceof Error ? e.message : e);
  process.exit(1);
});
