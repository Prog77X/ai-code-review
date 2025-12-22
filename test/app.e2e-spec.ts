import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/webhook/gitlab (POST)', () => {
    return request(app.getHttpServer())
      .post('/webhook/gitlab')
      .set('x-git-token', 'test-token')
      .send({
        object_kind: 'merge_request',
        object_attributes: {
          action: 'open',
          iid: 1,
          source_branch: 'feature',
          target_branch: 'main',
        },
        project: {
          id: 1,
          name: 'test',
          path_with_namespace: 'user/test',
        },
      })
      .expect(200);
  });
});

