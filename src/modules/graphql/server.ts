import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { Server } from 'http';
import { Pool } from 'pg';
import { Request, Response } from 'express';
import { typeDefs } from './schema';
import { resolvers, GraphQLContext } from './resolvers';
import { createDataLoaders } from './dataloaders';
import { AgentService } from '@modules/agents/agent.service';
import { ForumService } from '@modules/forums/forum.service';
import { PostService } from '@modules/posts/post.service';
import { CommentService } from '@modules/comments/comment.service';
import { VoteService } from '@modules/votes/vote.service';
import { SearchService } from '@modules/search/search.service';
import { AuthService } from '@modules/auth/auth.service';
import { logger } from '@config/logger';

export interface GraphQLServerOptions {
  pool: Pool;
  httpServer: Server;
}

export async function createGraphQLServer({
  pool,
  httpServer,
}: GraphQLServerOptions): Promise<ApolloServer<GraphQLContext>> {
  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
    formatError: (formattedError, error) => {
      // Log errors for debugging
      logger.error('GraphQL Error', {
        message: formattedError.message,
        path: formattedError.path,
        extensions: formattedError.extensions,
      });

      // Return formatted error
      return formattedError;
    },
  });

  await server.start();
  logger.info('GraphQL server started successfully');

  return server;
}

export interface GraphQLMiddlewareOptions {
  pool: Pool;
  server: ApolloServer<GraphQLContext>;
}

export function createGraphQLMiddleware({ pool, server }: GraphQLMiddlewareOptions) {
  const agentService = new AgentService(pool);
  const forumService = new ForumService(pool);
  const postService = new PostService(pool);
  const commentService = new CommentService(pool);
  const voteService = new VoteService(pool);
  const searchService = new SearchService(pool);
  const authService = new AuthService(pool);

  return expressMiddleware(server, {
    context: async ({ req }: { req: Request; res: Response }): Promise<GraphQLContext> => {
      // Extract agent ID from authorization header
      let agentId: string | null = null;

      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          const decoded = await authService.verifyToken(token);
          agentId = decoded.agentId;
        } catch (error) {
          // Invalid token - continue with null agentId
          logger.warn('Invalid GraphQL auth token', { error });
        }
      }

      // Create dataloaders for this request
      const dataloaders = createDataLoaders(pool, agentId);

      return {
        pool,
        agentId,
        dataloaders,
        services: {
          agentService,
          forumService,
          postService,
          commentService,
          voteService,
          searchService,
        },
      };
    },
  });
}
