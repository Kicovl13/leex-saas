import { Global, Module } from '@nestjs/common';
import { AwsEventBusService } from './aws-event-bus.service';

@Global()
@Module({
  providers: [AwsEventBusService],
  exports: [AwsEventBusService],
})
export class IntegrationsModule {}
