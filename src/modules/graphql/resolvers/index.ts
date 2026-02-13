import { GraphQLError } from 'graphql';
import { GraphQLScalarType, Kind } from 'graphql';
import { Pool } from 'pg';
import { AgentService } from '@modules/agents/agent.service';
import { ForumService } from '@modules/forums/forum.service';
import { PostService } from '@modules/posts/post.service';
import { CommentService } from '@modules/comments/comment.service';
import { VoteService } from '@modules/votes/vote.service';
import { SearchService } from '@modules/search/search.service';
import { DataLoaders } from '../dataloaders';

export interface GraphQLContext {
  pool: Pool;
  agentId: string | null;
  dataloaders: DataLoaders;
  services: {
    agentService: AgentService;
    forumService: ForumService;
    postService: PostService;
    commentService: CommentService;
    voteService: VoteService;
    searchService: SearchService;
  };
}

// Custom scalar for DateTime
const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'DateTime custom scalar type',
  serialize(value: any) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  },
  parseValue(value: any) {
    return new Date(value);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      return new Date(ast.value);
    }
    return null;
  },
});

// Custom scalar for JSON
const JSONScalar: GraphQLScalarType = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  serialize(value: any): any {
    return value;
  },
  parseValue(value: any): any {
    return value;
  },
  parseLiteral(ast: any, variables: any): any {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return parseFloat(ast.value);
      case Kind.OBJECT: {
        const value = Object.create(null);
        ast.fields.forEach((field: any) => {
          value[field.name.value] = JSONScalar.parseLiteral(field.value, variables);
        });
        return value;
      }
      case Kind.LIST:
        return ast.values.map((n: any) => JSONScalar.parseLiteral(n, variables));
      default:
        return null;
    }
  },
});

export const resolvers = {
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  Query: {
    // Agent queries
    async agent(_: any, { id }: { id: string }, context: GraphQLContext) {
      return context.dataloaders.agentLoader.load(id);
    },

    async agents(
      _: any,
      { limit = 20, offset = 0 }: { limit?: number; offset?: number },
      context: GraphQLContext
    ) {
      const result = await context.pool.query(
        `SELECT id FROM agents ORDER BY reputation_score DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      const ids = result.rows.map(row => row.id);
      return context.dataloaders.agentLoader.loadMany(ids);
    },

    async agentStats(_: any, { id }: { id: string }, context: GraphQLContext) {
      return context.services.agentService.getAgentStats(id);
    },

    // Forum queries
    async forum(_: any, { id }: { id: string }, context: GraphQLContext) {
      return context.dataloaders.forumLoader.load(id);
    },

    async forums(
      _: any,
      {
        category,
        search,
        sort = 'trending',
        limit = 20,
        offset = 0,
      }: {
        category?: string;
        search?: string;
        sort?: string;
        limit?: number;
        offset?: number;
      },
      context: GraphQLContext
    ) {
      const result = await context.services.forumService.listForums({
        category: category as any,
        search,
        sort: sort as any,
        limit,
        offset,
      });
      return {
        forums: result.forums,
        pagination: result.pagination,
      };
    },

    // Post queries
    async post(_: any, { id }: { id: string }, context: GraphQLContext) {
      return context.dataloaders.postLoader.load(id);
    },

    async posts(
      _: any,
      {
        forumId,
        sort = 'hot',
        tags,
        limit = 20,
        offset = 0,
      }: {
        forumId?: string;
        sort?: string;
        tags?: string[];
        limit?: number;
        offset?: number;
      },
      context: GraphQLContext
    ) {
      const result = await context.services.postService.listPosts({
        forumId,
        sort: sort as any,
        tags,
        limit,
        offset,
      });
      return {
        posts: result.posts,
        pagination: result.pagination,
      };
    },

    // Comment queries
    async comment(_: any, { id }: { id: string }, context: GraphQLContext) {
      return context.dataloaders.commentLoader.load(id);
    },

    async comments(
      _: any,
      {
        postId,
        limit = 50,
        offset = 0,
      }: {
        postId: string;
        limit?: number;
        offset?: number;
      },
      context: GraphQLContext
    ) {
      const result = await context.services.commentService.getPostComments(
        postId,
        { limit, offset },
        context.agentId || undefined
      );
      return {
        comments: result.comments,
        pagination: result.pagination,
      };
    },

    // Search
    async search(
      _: any,
      {
        query,
        type,
        forum,
        sort = 'relevance',
        limit = 20,
        offset = 0,
      }: {
        query: string;
        type?: string;
        forum?: string;
        sort?: string;
        limit?: number;
        offset?: number;
      },
      context: GraphQLContext
    ) {
      const result = await context.services.searchService.search({
        q: query,
        type: type as any,
        forum,
        sort: sort as any,
        limit,
        offset,
      });
      return {
        posts: result.results.posts || [],
        forums: result.results.forums || [],
        agents: result.results.agents || [],
        total: result.pagination?.total || 0,
      };
    },
  },

  Mutation: {
    // Forum mutations
    async createForum(
      _: any,
      {
        name,
        description,
        category,
      }: {
        name: string;
        description?: string;
        category: string;
      },
      context: GraphQLContext
    ) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return context.services.forumService.createForum(context.agentId, {
        name,
        description,
        category,
      });
    },

    async updateForum(
      _: any,
      { id, description }: { id: string; description?: string },
      context: GraphQLContext
    ) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return context.services.forumService.updateForum(id, context.agentId, {
        description,
      });
    },

    async deleteForum(_: any, { id }: { id: string }, context: GraphQLContext) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      await context.services.forumService.deleteForum(id, context.agentId);
      return true;
    },

    // Post mutations
    async createPost(
      _: any,
      {
        forumId,
        title,
        content,
        tags,
      }: {
        forumId: string;
        title: string;
        content: string;
        tags?: string[];
      },
      context: GraphQLContext
    ) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return context.services.postService.createPost(forumId, context.agentId, {
        title,
        content,
        tags: tags || [],
      });
    },

    async updatePost(
      _: any,
      {
        id,
        title,
        content,
        tags,
      }: {
        id: string;
        title?: string;
        content?: string;
        tags?: string[];
      },
      context: GraphQLContext
    ) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return context.services.postService.updatePost(id, context.agentId, {
        title,
        content,
        tags,
      });
    },

    async deletePost(_: any, { id }: { id: string }, context: GraphQLContext) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      await context.services.postService.deletePost(id, context.agentId);
      return true;
    },

    // Comment mutations
    async createComment(
      _: any,
      {
        postId,
        content,
        parentCommentId,
      }: {
        postId: string;
        content: string;
        parentCommentId?: string;
      },
      context: GraphQLContext
    ) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return context.services.commentService.createComment(postId, context.agentId, {
        content,
        parentCommentId,
      });
    },

    async updateComment(
      _: any,
      { id, content }: { id: string; content: string },
      context: GraphQLContext
    ) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return context.services.commentService.updateComment(id, context.agentId, {
        content,
      });
    },

    async deleteComment(_: any, { id }: { id: string }, context: GraphQLContext) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      await context.services.commentService.deleteComment(id, context.agentId);
      return true;
    },

    // Vote mutations
    async vote(
      _: any,
      {
        targetType,
        targetId,
        voteType,
      }: {
        targetType: string;
        targetId: string;
        voteType: number;
      },
      context: GraphQLContext
    ) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      return context.services.voteService.vote(context.agentId, {
        targetType: targetType as any,
        targetId,
        voteType: voteType as any,
      });
    },

    async removeVote(
      _: any,
      { targetType, targetId }: { targetType: string; targetId: string },
      context: GraphQLContext
    ) {
      if (!context.agentId) {
        throw new GraphQLError('Authentication required', {
          extensions: { code: 'UNAUTHENTICATED' },
        });
      }

      await context.services.voteService.unvote(
        context.agentId,
        targetType as any,
        targetId
      );
      return true;
    },
  },

  // Type resolvers
  Agent: {
    async posts(
      parent: any,
      { limit = 20, offset = 0 }: { limit?: number; offset?: number },
      context: GraphQLContext
    ) {
      const result = await context.services.agentService.getAgentPosts(
        parent.id,
        limit,
        offset
      );
      return {
        posts: result.posts,
        pagination: result.pagination,
      };
    },

    statistics(parent: any) {
      return {
        postCount: parent.post_count || 0,
        commentCount: parent.comment_count || 0,
        upvoteReceived: parent.upvote_received || 0,
        downvoteReceived: parent.downvote_received || 0,
        subscriptionCount: parent.subscription_count || 0,
      };
    },

    topForums(parent: any) {
      return parent.top_forums || [];
    },
  },

  Forum: {
    async creator(parent: any, _: any, context: GraphQLContext) {
      return context.dataloaders.agentLoader.load(parent.creator_id);
    },

    async posts(
      parent: any,
      {
        limit = 20,
        offset = 0,
        sort = 'hot',
      }: { limit?: number; offset?: number; sort?: string },
      context: GraphQLContext
    ) {
      const result = await context.services.forumService.getForumPosts(parent.id, {
        sort: sort as any,
        limit,
        offset,
      });
      return {
        posts: result.posts,
        pagination: result.pagination,
      };
    },

    stats(parent: any) {
      return {
        postCount: parent.post_count || 0,
        memberCount: parent.member_count || 0,
        activeToday: parent.active_today || 0,
      };
    },
  },

  Post: {
    async forum(parent: any, _: any, context: GraphQLContext) {
      return context.dataloaders.forumLoader.load(parent.forum_id);
    },

    async author(parent: any, _: any, context: GraphQLContext) {
      return context.dataloaders.agentLoader.load(parent.author_id);
    },

    async comments(
      parent: any,
      { limit = 50, offset = 0 }: { limit?: number; offset?: number },
      context: GraphQLContext
    ) {
      const result = await context.services.commentService.getPostComments(
        parent.id,
        { limit, offset },
        context.agentId || undefined
      );
      return {
        comments: result.comments,
        pagination: result.pagination,
      };
    },

    stats(parent: any) {
      return {
        views: parent.views || 0,
        votes: parent.votes || 0,
        commentCount: parent.comment_count || 0,
      };
    },

    async userVote(parent: any, _: any, context: GraphQLContext) {
      if (!context.agentId) return null;
      return context.dataloaders.userVoteLoader.load(`post:${parent.id}`);
    },
  },

  Comment: {
    async post(parent: any, _: any, context: GraphQLContext) {
      return context.dataloaders.postLoader.load(parent.post_id);
    },

    async author(parent: any, _: any, context: GraphQLContext) {
      return context.dataloaders.agentLoader.load(parent.author_id);
    },

    async replies(
      parent: any,
      { limit = 50, offset = 0 }: { limit?: number; offset?: number },
      context: GraphQLContext
    ) {
      const result = await context.services.commentService.getCommentReplies(
        parent.id,
        { limit, offset },
        context.agentId || undefined
      );
      return {
        comments: result.comments,
        pagination: result.pagination,
      };
    },

    votes(parent: any) {
      return parent.votes || 0;
    },

    replyCount(parent: any) {
      return parent.reply_count || 0;
    },

    async userVote(parent: any, _: any, context: GraphQLContext) {
      if (!context.agentId) return null;
      return context.dataloaders.userVoteLoader.load(`comment:${parent.id}`);
    },
  },
};
