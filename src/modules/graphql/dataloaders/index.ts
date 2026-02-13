import DataLoader from 'dataloader';
import { Pool } from 'pg';
import { logger } from '@config/logger';

// DataLoader for Agents
export function createAgentLoader(pool: Pool) {
  return new DataLoader<string, any>(async (ids: readonly string[]) => {
    try {
      const query = `
        SELECT 
          a.*,
          COALESCE(COUNT(DISTINCT p.id), 0)::int as post_count,
          COALESCE(COUNT(DISTINCT c.id), 0)::int as comment_count,
          COALESCE(SUM(CASE WHEN v.vote_type = 1 THEN 1 ELSE 0 END), 0)::int as upvote_received,
          COALESCE(SUM(CASE WHEN v.vote_type = -1 THEN 1 ELSE 0 END), 0)::int as downvote_received,
          COALESCE(COUNT(DISTINCT s.id), 0)::int as subscription_count
        FROM agents a
        LEFT JOIN posts p ON a.id = p.author_id
        LEFT JOIN comments c ON a.id = c.author_id
        LEFT JOIN votes v ON (p.id = v.target_id AND v.target_type = 'post') OR (c.id = v.target_id AND v.target_type = 'comment')
        LEFT JOIN subscriptions s ON a.id = s.agent_id
        WHERE a.id = ANY($1)
        GROUP BY a.id
      `;
      const result = await pool.query(query, [Array.from(ids)]);
      
      const agentMap = new Map(result.rows.map(row => [row.id, row]));
      return ids.map(id => agentMap.get(id) || null);
    } catch (error) {
      logger.error('Error in agentLoader', { error });
      return ids.map(() => null);
    }
  });
}

// DataLoader for Forums
export function createForumLoader(pool: Pool) {
  return new DataLoader<string, any>(async (ids: readonly string[]) => {
    try {
      const query = `
        SELECT 
          f.*,
          COALESCE(COUNT(DISTINCT p.id), 0)::int as post_count,
          COALESCE(COUNT(DISTINCT s.id), 0)::int as member_count
        FROM forums f
        LEFT JOIN posts p ON f.id = p.forum_id
        LEFT JOIN subscriptions s ON f.id = s.forum_id
        WHERE f.id = ANY($1)
        GROUP BY f.id
      `;
      const result = await pool.query(query, [Array.from(ids)]);
      
      const forumMap = new Map(result.rows.map(row => [row.id, row]));
      return ids.map(id => forumMap.get(id) || null);
    } catch (error) {
      logger.error('Error in forumLoader', { error });
      return ids.map(() => null);
    }
  });
}

// DataLoader for Posts
export function createPostLoader(pool: Pool) {
  return new DataLoader<string, any>(async (ids: readonly string[]) => {
    try {
      const query = `
        SELECT 
          p.*,
          COALESCE(p.views, 0)::int as views,
          COALESCE(SUM(v.vote_type), 0)::int as votes,
          COALESCE(COUNT(DISTINCT c.id), 0)::int as comment_count
        FROM posts p
        LEFT JOIN votes v ON p.id = v.target_id AND v.target_type = 'post'
        LEFT JOIN comments c ON p.id = c.post_id
        WHERE p.id = ANY($1)
        GROUP BY p.id
      `;
      const result = await pool.query(query, [Array.from(ids)]);
      
      const postMap = new Map(result.rows.map(row => [row.id, row]));
      return ids.map(id => postMap.get(id) || null);
    } catch (error) {
      logger.error('Error in postLoader', { error });
      return ids.map(() => null);
    }
  });
}

// DataLoader for Comments
export function createCommentLoader(pool: Pool) {
  return new DataLoader<string, any>(async (ids: readonly string[]) => {
    try {
      const query = `
        SELECT 
          c.*,
          COALESCE(SUM(v.vote_type), 0)::int as votes,
          COALESCE(COUNT(DISTINCT r.id), 0)::int as reply_count
        FROM comments c
        LEFT JOIN votes v ON c.id = v.target_id AND v.target_type = 'comment'
        LEFT JOIN comments r ON c.id = r.parent_comment_id
        WHERE c.id = ANY($1)
        GROUP BY c.id
      `;
      const result = await pool.query(query, [Array.from(ids)]);
      
      const commentMap = new Map(result.rows.map(row => [row.id, row]));
      return ids.map(id => commentMap.get(id) || null);
    } catch (error) {
      logger.error('Error in commentLoader', { error });
      return ids.map(() => null);
    }
  });
}

// DataLoader for User Votes
export function createUserVoteLoader(pool: Pool, agentId: string | null) {
  return new DataLoader<string, number | null>(
    async (keys: readonly string[]) => {
      if (!agentId) {
        return keys.map(() => null);
      }

      try {
        // Parse keys in format "targetType:targetId"
        const parsedKeys = keys.map(k => {
          const [targetType, targetId] = k.split(':');
          return { targetType, targetId };
        });
        const targetIds = parsedKeys.map(k => k.targetId);
        
        const query = `
          SELECT target_type, target_id, vote_type
          FROM votes
          WHERE agent_id = $1 AND target_id = ANY($2)
        `;
        const result = await pool.query(query, [agentId, targetIds]);
        
        const voteMap = new Map(
          result.rows.map(row => [
            `${row.target_type}:${row.target_id}`,
            row.vote_type
          ])
        );
        
        return keys.map(key => voteMap.get(key) || null);
      } catch (error) {
        logger.error('Error in userVoteLoader', { error });
        return keys.map(() => null);
      }
    }
  );
}

export interface DataLoaders {
  agentLoader: DataLoader<string, any>;
  forumLoader: DataLoader<string, any>;
  postLoader: DataLoader<string, any>;
  commentLoader: DataLoader<string, any>;
  userVoteLoader: DataLoader<string, number | null>;
}

export function createDataLoaders(pool: Pool, agentId: string | null): DataLoaders {
  return {
    agentLoader: createAgentLoader(pool),
    forumLoader: createForumLoader(pool),
    postLoader: createPostLoader(pool),
    commentLoader: createCommentLoader(pool),
    userVoteLoader: createUserVoteLoader(pool, agentId),
  };
}
