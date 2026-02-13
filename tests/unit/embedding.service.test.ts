/**
 * Embedding Service Unit Tests
 */

// Mock logger first
jest.mock('@config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock env
jest.mock('@config/env', () => ({
  env: {
    OPENAI_API_KEY: 'test-api-key',
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
  },
}));

// Create mock embeddings.create function
const mockEmbeddingsCreate = jest.fn();

// Mock OpenAI
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      embeddings: {
        create: mockEmbeddingsCreate,
      },
    })),
  };
});

import { EmbeddingService } from '@modules/memory/embedding.service';

describe('EmbeddingService', () => {
  let embeddingService: EmbeddingService;

  beforeEach(() => {
    jest.clearAllMocks();
    embeddingService = new EmbeddingService();
  });

  describe('isServiceEnabled', () => {
    it('should return true when API key is configured', () => {
      expect(embeddingService.isServiceEnabled()).toBe(true);
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for a single text', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });

      const embedding = await embeddingService.generateEmbedding('test content');

      expect(embedding).toEqual(mockEmbedding);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test content',
        encoding_format: 'float',
      });
    });

    it('should throw error when service is not configured', async () => {
      const serviceWithoutKey = new EmbeddingService();
      // Force client to null
      (serviceWithoutKey as any).client = null;
      (serviceWithoutKey as any).isEnabled = false;

      await expect(serviceWithoutKey.generateEmbedding('test')).rejects.toThrow('Embedding service not configured');
    });

    it('should handle API errors', async () => {
      mockEmbeddingsCreate.mockRejectedValue(new Error('API error'));

      await expect(embeddingService.generateEmbedding('test')).rejects.toThrow('API error');
    });
  });

  describe('generateEmbeddings', () => {
    it('should generate embeddings for multiple texts', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ];

      mockEmbeddingsCreate.mockResolvedValue({
        data: mockEmbeddings.map((embedding) => ({ embedding })),
      });

      const texts = ['text 1', 'text 2', 'text 3'];
      const embeddings = await embeddingService.generateEmbeddings(texts);

      expect(embeddings).toEqual(mockEmbeddings);
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: texts,
        encoding_format: 'float',
      });
    });

    it('should throw error when service is not configured', async () => {
      const serviceWithoutKey = new EmbeddingService();
      (serviceWithoutKey as any).client = null;
      (serviceWithoutKey as any).isEnabled = false;

      await expect(serviceWithoutKey.generateEmbeddings(['test'])).rejects.toThrow('Embedding service not configured');
    });
  });

  describe('cosineSimilarity', () => {
    it('should calculate cosine similarity correctly', () => {
      const vectorA = [1, 0, 0];
      const vectorB = [1, 0, 0];

      const similarity = embeddingService.cosineSimilarity(vectorA, vectorB);

      expect(similarity).toBe(1);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vectorA = [1, 0, 0];
      const vectorB = [0, 1, 0];

      const similarity = embeddingService.cosineSimilarity(vectorA, vectorB);

      expect(similarity).toBe(0);
    });

    it('should handle negative values', () => {
      const vectorA = [1, 0, 0];
      const vectorB = [-1, 0, 0];

      const similarity = embeddingService.cosineSimilarity(vectorA, vectorB);

      expect(similarity).toBe(-1);
    });

    it('should throw error for vectors of different dimensions', () => {
      const vectorA = [1, 0, 0];
      const vectorB = [1, 0];

      expect(() => embeddingService.cosineSimilarity(vectorA, vectorB)).toThrow(
        'Vectors must have the same dimension',
      );
    });

    it('should return 0 when one vector has zero norm', () => {
      const vectorA = [0, 0, 0];
      const vectorB = [1, 0, 0];

      const similarity = embeddingService.cosineSimilarity(vectorA, vectorB);

      expect(similarity).toBe(0);
    });
  });
});
