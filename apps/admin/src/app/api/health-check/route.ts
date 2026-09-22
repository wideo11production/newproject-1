import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Define the services to check
    const services = [
      { name: 'Recommendation Service', url: process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:8082' },
      { name: 'Bot Service', url: process.env.BOT_SERVICE_URL || 'http://localhost:8080' },
    ];

    const results = await Promise.all(
      services.map(async (service) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

          const response = await fetch(`${service.url}/health`, {
            signal: controller.signal,
            method: 'GET',
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            return { service: service.name, status: 'OK', responseTime: 0 }; // We don't measure response time here for simplicity
          } else {
            return { service: service.name, status: 'ERROR', error: `HTTP ${response.status}` };
          }
        } catch (error: any) {
          return { service: service.name, status: 'ERROR', error: error.message };
        }
      })
    );

    const allOK = results.every((r) => r.status === 'OK');

    return NextResponse.json(
      {
        status: allOK ? 'OK' : 'DEGRADED',
        timestamp: new Date().toISOString(),
        services: results,
      },
      { status: allOK ? 200 : 503 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'ERROR',
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}