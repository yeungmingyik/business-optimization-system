import 'reflect-metadata';
import { DatabaseService } from './database.service';
import { AuthService } from './auth.service';

async function main() {
  const database = new DatabaseService();
  try {
    if (process.argv[2] === 'migrate') await database.migrate();
    else if (process.argv[2] === 'init') await new AuthService(database).initialize();
    else throw new Error('命令无效');
  } finally {
    await database.onModuleDestroy();
  }
}
main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
