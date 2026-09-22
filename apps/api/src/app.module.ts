import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { TransferModule } from './transfer/transfer.module';
import { WaybillModule } from './waybills/waybill.module';

@Module({ imports: [CoreModule, TransferModule, WaybillModule] })
export class AppModule {}
