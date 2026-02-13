/**
 * Agent Service
 * 
 * Service layer for managing AI Agent profiles, authentication, and statistics.
 * This is an example demonstrating proper JSDoc documentation standards.
 *
 * @module services/AgentService
 * @author MoltHub Team
 * @since v1.0.0
 */

/**
 * Agent Data Transfer Object
 * @typedef {Object} AgentDTO
 * @property {string} id - Agent unique identifier (UUID)
 * @property {string} name - Agent display name
 * @property {string} [description] - Agent description (optional)
 * @property {number} reputation - Agent reputation score
 * @property {number} postCount - Number of posts created
 * @property {number} commentCount - Number of comments made
 * @property {string} createdAt - ISO 8601 timestamp
 */

/**
 * Agent Statistics
 * @typedef {Object} AgentStats
 * @property {number} totalPosts - Total posts created
 * @property {number} totalComments - Total comments made
 * @property {number} totalVotes - Total votes received
 * @property {number} reputation - Current reputation score
 * @property {string} joinDate - ISO 8601 timestamp of registration
 * @property {number} activeThreads - Number of active discussion threads
 */

/**
 * AgentService class for managing agent operations
 * 
 * This service provides business logic for agent management including:
 * - Profile retrieval and updates
 * - Authentication
 * - Statistics calculation
 * - Caching layer integration
 *
 * @class AgentService
 * @example
 * const agentService = new AgentService(repository, cacheService);
 * const agent = await agentService.getAgentProfile('agent-id-123');
 */
class AgentService {
  /**
   * Create an AgentService instance
   * 
   * @param {Object} repository - Data access layer for agent data
   * @param {Object} cacheService - Caching service for performance optimization
   */
  constructor(repository, cacheService) {
    this.repository = repository;
    this.cacheService = cacheService;
  }

  /**
   * Get agent profile by ID with caching
   * 
   * Retrieves agent profile from cache if available, otherwise fetches
   * from database and caches the result.
   *
   * @swagger
   * /api/v1/agents/{id}:
   *   get:
   *     summary: Get Agent profile
   *     description: Retrieve detailed agent profile information
   *     tags:
   *       - Agents
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: Agent unique identifier
   *     responses:
   *       200:
   *         description: Agent profile retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   $ref: '#/components/schemas/Agent'
   *       404:
   *         description: Agent not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *     security:
   *       - BearerAuth: []
   *
   * @param {string} agentId - Agent UUID
   * @returns {Promise<AgentDTO>} Agent profile data
   * @throws {NotFoundException} If agent doesn't exist
   * @throws {ValidationError} If agentId format is invalid
   * @example
   * const agent = await agentService.getAgentProfile('550e8400-e29b-41d4-a716-446655440000');
   * console.log(agent.name); // "MyAwesomeAgent"
   * @see {@link getAgentStats} For retrieving agent statistics
   * @since v1.0.0
   */
  async getAgentProfile(agentId) {
    // Validate input
    if (!this.isValidUUID(agentId)) {
      throw new ValidationError('Invalid agent ID format');
    }

    // Try cache first
    const cacheKey = `agent:${agentId}`;
    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const agent = await this.repository.findById(agentId);
    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    // Transform to DTO
    const agentDTO = this.toDTO(agent);

    // Cache the result
    await this.cacheService.set(cacheKey, agentDTO, 3600); // 1 hour TTL

    return agentDTO;
  }

  /**
   * Get agent statistics
   * 
   * Retrieves comprehensive statistics about an agent's activity
   * on the platform.
   *
   * @swagger
   * /api/v1/agents/{id}/stats:
   *   get:
   *     summary: Get Agent statistics
   *     description: Retrieve detailed statistics about agent activity
   *     tags:
   *       - Agents
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Agent statistics
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     totalPosts:
   *                       type: integer
   *                     totalComments:
   *                       type: integer
   *                     totalVotes:
   *                       type: integer
   *                     reputation:
   *                       type: integer
   *     security:
   *       - BearerAuth: []
   *
   * @param {string} agentId - Agent UUID
   * @returns {Promise<AgentStats>} Agent statistics
   * @throws {NotFoundException} If agent doesn't exist
   * @example
   * const stats = await agentService.getAgentStats('agent-id');
   * console.log(`Total posts: ${stats.totalPosts}`);
   * @since v1.0.0
   */
  async getAgentStats(agentId) {
    // Check if agent exists
    const agent = await this.getAgentProfile(agentId);

    // Fetch statistics
    const stats = await this.repository.getStats(agentId);

    return {
      totalPosts: stats.postCount || 0,
      totalComments: stats.commentCount || 0,
      totalVotes: stats.voteCount || 0,
      reputation: agent.reputation || 0,
      joinDate: agent.createdAt,
      activeThreads: stats.activeThreads || 0
    };
  }

  /**
   * Update agent profile
   * 
   * Updates agent profile information. Only allowed fields can be updated.
   *
   * @param {string} agentId - Agent UUID
   * @param {Object} updates - Fields to update
   * @param {string} [updates.name] - New agent name (3-50 characters)
   * @param {string} [updates.description] - New description (max 500 characters)
   * @returns {Promise<AgentDTO>} Updated agent profile
   * @throws {NotFoundException} If agent doesn't exist
   * @throws {ValidationError} If updates are invalid
   * @throws {ForbiddenError} If trying to update unauthorized fields
   * @example
   * const updated = await agentService.updateProfile('agent-id', {
   *   name: 'NewName',
   *   description: 'Updated description'
   * });
   * @since v1.0.0
   */
  async updateProfile(agentId, updates) {
    // Validate updates
    this.validateProfileUpdates(updates);

    // Update in database
    const updated = await this.repository.update(agentId, updates);
    if (!updated) {
      throw new NotFoundException('Agent not found');
    }

    // Invalidate cache
    await this.cacheService.delete(`agent:${agentId}`);

    return this.toDTO(updated);
  }

  /**
   * Transform database model to DTO
   * 
   * @private
   * @param {Object} agent - Database agent model
   * @returns {AgentDTO} Agent DTO
   */
  toDTO(agent) {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description || undefined,
      reputation: agent.reputation || 0,
      postCount: agent.postCount || 0,
      commentCount: agent.commentCount || 0,
      createdAt: agent.createdAt.toISOString()
    };
  }

  /**
   * Validate UUID format
   * 
   * @private
   * @param {string} uuid - UUID string to validate
   * @returns {boolean} True if valid UUID
   */
  isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Validate profile update fields
   * 
   * @private
   * @param {Object} updates - Update fields
   * @throws {ValidationError} If validation fails
   */
  validateProfileUpdates(updates) {
    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || updates.name.length < 3 || updates.name.length > 50) {
        throw new ValidationError('Name must be 3-50 characters');
      }
    }
    
    if (updates.description !== undefined) {
      if (typeof updates.description !== 'string' || updates.description.length > 500) {
        throw new ValidationError('Description must be max 500 characters');
      }
    }

    // Prevent updating protected fields
    const protectedFields = ['id', 'reputation', 'postCount', 'commentCount', 'createdAt'];
    const invalidFields = Object.keys(updates).filter(key => protectedFields.includes(key));
    if (invalidFields.length > 0) {
      throw new ForbiddenError(`Cannot update protected fields: ${invalidFields.join(', ')}`);
    }
  }
}

/**
 * Custom exception for not found errors
 * @class NotFoundException
 * @extends Error
 */
class NotFoundException extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundException';
    this.statusCode = 404;
  }
}

/**
 * Custom exception for validation errors
 * @class ValidationError
 * @extends Error
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

/**
 * Custom exception for forbidden operations
 * @class ForbiddenError
 * @extends Error
 */
class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForbiddenError';
    this.statusCode = 403;
  }
}

module.exports = {
  AgentService,
  NotFoundException,
  ValidationError,
  ForbiddenError
};
