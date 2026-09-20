import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { TransferModule } from './transfer/transfer.module';

@Module({ imports: [CoreModule, TransferModule] })
export class AppModule {}
