import 'reflect-metadata';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  entities,
  Measurement,
  Report,
  Capture,
} from '../dist/database/entities.js';
import { Initial1791900000000 } from '../dist/database/migrations/1791900000000-Initial.js';
import { StorageService } from '../dist/storage/storage.service.js';
import {
  DIAGNOSIS_PROVIDER,
  MockDiagnosisProvider,
} from '../dist/diagnosis/diagnosis.provider.js';
import { JsonErrorFilter } from '../dist/common/errors.js';

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    'TEST_DATABASE_URL must point to a dedicated empty PostgreSQL 17 test database',
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
Object.assign(process.env, {
  SPACES_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
  SPACES_KEY: 'test',
  SPACES_SECRET: 'test',
  SPACES_BUCKET: 'test',
});
const db = new DataSource({
  type: 'postgres',
  url: process.env.TEST_DATABASE_URL,
  entities,
  migrations: [Initial1791900000000],
  synchronize: false,
  uuidExtension: 'pgcrypto',
});
let app;
const uploads = new Set();
let failProvider = false;
let invalidReport = false;
const provider = new MockDiagnosisProvider();
let problemId, captureId;
before(async () => {
  await db.initialize();
  assert.equal(
    await db
      .query("SELECT to_regclass('public.problems') AS name")
      .then((rows) => rows[0].name),
    null,
    'Use an empty dedicated test database',
  );
  await db.runMigrations();
  const { AppModule } = await import('../dist/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useValue({
      presign: async () => ({
        url: 'https://test.invalid',
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        expires_in: 300,
      }),
      exists: async (key) => uploads.has(key),
    })
    .overrideProvider(DIAGNOSIS_PROVIDER)
    .useValue({
      diagnose: async (...args) => {
        if (failProvider) throw new Error('simulated provider failure');
        const result = await provider.diagnose(...args);
        if (invalidReport) result.report.confidence = '1.50';
        return result;
      },
    })
    .compile();
  app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new JsonErrorFilter());
  await app.init();
});
after(async () => {
  if (app) await app.close();
  if (db.isInitialized) {
    // Only revert migrations this test actually applied.
    if (app) await db.undoLastMigration();
    await db.destroy();
  }
});
const api = () => request(app.getHttpServer());
test('database seed, generated column, and view metadata match the schema', async () => {
  const [user] = await db.query(
    "SELECT * FROM users WHERE id='00000000-0000-0000-0000-000000000001'",
  );
  assert.equal(user.clerk_id, 'demo');
  const [generated] = await db.query(
    "SELECT is_generated FROM information_schema.columns WHERE table_name='measurements' AND column_name='area_mm2'",
  );
  assert.equal(generated.is_generated, 'ALWAYS');
  const diff = await db.driver.createSchemaBuilder().log();
  assert.deepEqual(
    diff.upQueries.map((q) => q.query),
    [],
    'No entity drift after reviewed migration',
  );
});
test('validates body and UUID params with consistent errors', async () => {
  const bad = await api()
    .post('/problems')
    .send({ title: '', surprise: true })
    .expect(400);
  assert.equal(bad.body.error.status, 400);
  assert.ok(Array.isArray(bad.body.error.message));
  await api().get('/problems/not-a-uuid').expect(400);
  await api()
    .post('/problems')
    .send({ title: 'Test', category: null })
    .expect(400);
});
test('creates, lists, and reads a demo-owned problem', async () => {
  const created = await api()
    .post('/problems')
    .send({ title: 'Basement crack', category: 'crack' })
    .expect(201);
  problemId = created.body.id;
  assert.equal(created.body.user_id, '00000000-0000-0000-0000-000000000001');
  assert.ok(
    (await api().get('/problems').expect(200)).body.some(
      (p) => p.id === problemId,
    ),
  );
  const detail = await api().get(`/problems/${problemId}`).expect(200);
  assert.equal(detail.body.latest_report, null);
  assert.equal(detail.body.delta_summary, null);
});
test('hides problems owned by another user', async () => {
  const otherId = randomUUID();
  await db.query('INSERT INTO users (id, clerk_id) VALUES ($1,$2)', [
    otherId,
    otherId,
  ]);
  const [other] = await db.query(
    "INSERT INTO problems (user_id,title) VALUES ($1,'Private') RETURNING id",
    [otherId],
  );
  await api().get(`/problems/${other.id}`).expect(404);
  await api().post(`/problems/${other.id}/captures/upload-url`).expect(404);
  await api()
    .post(`/problems/${other.id}/diagnose`)
    .send({ capture_id: randomUUID() })
    .expect(404);
});
test('presigns, verifies upload, and rejects wrong keys and duplicate baselines', async () => {
  const signed = await api()
    .post(`/problems/${problemId}/captures/upload-url`)
    .expect(201);
  captureId = signed.body.capture_id;
  assert.equal(signed.body.photo_key, `captures/${problemId}/${captureId}.jpg`);
  const dto = {
    photo_key: signed.body.photo_key,
    is_baseline: true,
    photo_width_px: 1000,
    photo_height_px: 800,
    taken_at: '2026-10-01T12:00:00Z',
  };
  await api().post(`/problems/${problemId}/captures`).send(dto).expect(400);
  uploads.add(dto.photo_key);
  await api()
    .post(`/problems/${problemId}/captures`)
    .send({ ...dto, alignment_score: 0.9 })
    .expect(400);
  const created = await api()
    .post(`/problems/${problemId}/captures`)
    .send(dto)
    .expect(201);
  assert.equal(created.body.id, captureId);
  const second = `captures/${problemId}/${randomUUID()}.jpg`;
  uploads.add(second);
  await api()
    .post(`/problems/${problemId}/captures`)
    .send({ ...dto, photo_key: second })
    .expect(409);
  await api()
    .post(`/problems/${problemId}/captures`)
    .send({ photo_key: `captures/${randomUUID()}/${randomUUID()}.jpg` })
    .expect(400);
});
test('diagnosis is atomic, safety-gated, and repeated diagnosis conflicts', async () => {
  const result = await api()
    .post(`/problems/${problemId}/diagnose`)
    .send({ capture_id: captureId, hazards: ['gas'] })
    .expect(201);
  assert.equal(result.body.measurement.scale_mm_per_px, null);
  assert.equal(result.body.report.safety_override, true);
  assert.equal(result.body.report.urgency, 'pro_now');
  assert.equal(result.body.report.diy, null);
  await api()
    .post(`/problems/${problemId}/diagnose`)
    .send({ capture_id: captureId })
    .expect(409);
  const detail = await api().get(`/problems/${problemId}`).expect(200);
  assert.equal(detail.body.current_urgency, 'pro_now');
  assert.equal(detail.body.latest_report.id, result.body.report.id);
});
test('provider failures roll back and concurrent diagnosis only writes once', async () => {
  const capture = await db.getRepository(Capture).save({
    problem_id: problemId,
    photo_key: 'test.jpg',
    taken_at: new Date('2026-10-05T12:00:00Z'),
  });
  failProvider = true;
  await api()
    .post(`/problems/${problemId}/diagnose`)
    .send({ capture_id: capture.id })
    .expect(500);
  failProvider = false;
  assert.equal(
    await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
    0,
  );
  assert.equal(
    await db.getRepository(Report).countBy({ capture_id: capture.id }),
    0,
  );
  const responses = await Promise.all([
    api()
      .post(`/problems/${problemId}/diagnose`)
      .send({ capture_id: capture.id }),
    api()
      .post(`/problems/${problemId}/diagnose`)
      .send({ capture_id: capture.id }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
    1,
  );
  const deltas = await api().get(`/problems/${problemId}/deltas`).expect(200);
  assert.equal(deltas.body[0].growth, 'unknown');
  assert.equal(deltas.body[0].area_change_pct, null);
});
test('a report insert failure rolls back the already-inserted measurement', async () => {
  const capture = await db.getRepository(Capture).save({
    problem_id: problemId,
    photo_key: 'rollback.jpg',
    taken_at: new Date('2026-10-06T12:00:00Z'),
  });
  invalidReport = true;
  await api()
    .post(`/problems/${problemId}/diagnose`)
    .send({ capture_id: capture.id })
    .expect(500);
  invalidReport = false;
  assert.equal(
    await db.getRepository(Measurement).countBy({ capture_id: capture.id }),
    0,
  );
  assert.equal(
    await db.getRepository(Report).countBy({ capture_id: capture.id }),
    0,
  );
});
test('scaled deltas use generated mm area and report growth', async () => {
  const captures = await db
    .getRepository(Capture)
    .find({ where: { problem_id: problemId }, order: { taken_at: 'ASC' } });
  await db
    .getRepository(Measurement)
    .update(
      { capture_id: captures[0].id },
      { area_px: 100, scale_mm_per_px: 2, width_mm: 10 },
    );
  await db
    .getRepository(Measurement)
    .update(
      { capture_id: captures[1].id },
      { area_px: 125, scale_mm_per_px: 2, width_mm: 12 },
    );
  const deltas = await api().get(`/problems/${problemId}/deltas`).expect(200);
  assert.equal(deltas.body[0].growth, 'growing');
  assert.equal(deltas.body[0].area_change_pct, 25);
  assert.equal(deltas.body[0].width_change_mm, 2);
  assert.equal(Number(deltas.body[0].days_between), 4);
});
