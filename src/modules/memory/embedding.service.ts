/**
 * Embedding Service
 * Handles content vectorization using OpenAI embeddings
 */

import OpenAI from 'openai';
import { env } from '@config/env';
import { logger } from '@config/logger';

export class EmbeddingService {
  private client: OpenAI | null = null;
  private model: string;
  private isEnabled: boolean;

  constructor() {
    this.model = env.OPENAI_EMBEDDING_MODEL;
    this.isEnabled = !!env.OPENAI_API_KEY;

    if (this.isEnabled && env.OPENAI_API_KEY) {
      this.client = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
      });
      logger.info('Embedding service initialized', { model: this.model });
    } else {
      logger.warn('Embedding service disabled - OPENAI_API_KEY not configured');
    }
  }

  /**
   * Check if embedding service is enabled
   */
  isServiceEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.client) {
      throw new Error('Embedding service not configured');
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float',
      });

      const embedding = response.data[0].embedding;
      logger.debug('Embedding generated', {
        textLength: text.length,
        embeddingDimension: embedding.length,
      });

      return embedding;
    } catch (error) {
      logger.error('Failed to generate embedding', { error, textLength: text.length });
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.client) {
      throw new Error('Embedding service not configured');
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
        encoding_format: 'float',
      });

      const embeddings = response.data.map((item) => item.embedding);
      logger.debug('Batch embeddings generated', {
        count: texts.length,
        embeddingDimension: embeddings[0]?.length || 0,
      });

      return embeddings;
    } catch (error) {
      logger.error('Failed to generate batch embeddings', { error, count: texts.length });
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }
}

// Export singleton instance
export const embeddingService = new EmbeddingService();
