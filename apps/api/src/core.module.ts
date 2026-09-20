import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseService } from './database.service';
import { AuthService, AuthGuard } from './auth.service';
import { CoreService } from './core.service';
import { CoreController } from './core.controller';

@Global()
@Module({
  controllers: [CoreController],
  providers: [
    DatabaseService,
    AuthService,
    CoreService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [DatabaseService, AuthService, CoreService],
})
export class CoreModule {}
