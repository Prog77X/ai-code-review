import { Test, TestingModule } from '@nestjs/testing';
import { DiffService } from './diff.service';

describe('DiffService', () => {
  let service: DiffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DiffService],
    }).compile();

    service = module.get<DiffService>(DiffService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should parse diff correctly', () => {
    const diff = `@@ -1,3 +1,4 @@
 line1
+new line
 line2
-line3
+line3 updated
`;
    const result = service.parseDiff(diff, 'test.ts');
    expect(result.filePath).toBe('test.ts');
    expect(result.diffLines.length).toBeGreaterThan(0);
  });
});

