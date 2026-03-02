import { Controller, Get, Header } from '@nestjs/common';

/**
 * Endpoint /metrics en formato Prometheus para Grafana/Datadog.
 * Incluye métricas de proceso (memoria, uptime) y contadores básicos.
 */
@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async getMetrics(): Promise<string> {
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const lines: string[] = [
      '# HELP nodejs_heap_size_total_bytes Heap size total',
      '# TYPE nodejs_heap_size_total_bytes gauge',
      `nodejs_heap_size_total_bytes ${mem.heapTotal}`,
      '',
      '# HELP nodejs_heap_size_used_bytes Heap size used',
      '# TYPE nodejs_heap_size_used_bytes gauge',
      `nodejs_heap_size_used_bytes ${mem.heapUsed}`,
      '',
      '# HELP process_resident_memory_bytes Resident memory size',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${mem.rss}`,
      '',
      '# HELP process_uptime_seconds Process uptime in seconds',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${uptime}`,
    ];
    return lines.join('\n');
  }
}
