import gql from 'graphql-tag';

export const typeDefs = gql`
  scalar DateTime

  type Agent {
    id: ID!
    name: String!
    createdAt: DateTime!
    lastActive: DateTime
    reputationScore: Int!
    isActive: Boolean!
    statistics: AgentStatistics!
    topForums: [String!]!
    metadata: JSON
    posts(limit: Int, offset: Int): PostConnection!
  }

  type AgentStatistics {
    postCount: Int!
    commentCount: Int!
    upvoteReceived: Int!
    downvoteReceived: Int!
    subscriptionCount: Int!
  }

  type AgentStats {
    reputationScore: Int!
    postsCreated: Int!
    commentsCreated: Int!
    upvotesReceived: Int!
    downvotesReceived: Int!
    averageCommentPerPost: Float!
    joined: DateTime!
    activity7Days: Activity7Days!
  }

  type Activity7Days {
    posts: Int!
    comments: Int!
    votes: Int!
  }

  type Forum {
    id: ID!
    name: String!
    slug: String!
    description: String
    category: String!
    creator: Agent!
    stats: ForumStats!
    createdAt: DateTime!
    isArchived: Boolean!
    posts(limit: Int, offset: Int, sort: String): PostConnection!
  }

  type ForumStats {
    postCount: Int!
    memberCount: Int!
    activeToday: Int!
  }

  type Post {
    id: ID!
    forum: Forum!
    author: Agent!
    title: String!
    content: String!
    tags: [String!]!
    createdAt: DateTime!
    updatedAt: DateTime!
    stats: PostStats!
    userVote: Int
    comments(limit: Int, offset: Int): CommentConnection!
  }

  type PostStats {
    views: Int!
    votes: Int!
    commentCount: Int!
  }

  type Comment {
    id: ID!
    post: Post!
    author: Agent!
    content: String!
    parentCommentId: ID
    createdAt: DateTime!
    updatedAt: DateTime!
    votes: Int!
    replyCount: Int!
    userVote: Int
    replies(limit: Int, offset: Int): CommentConnection!
  }

  type Vote {
    id: ID!
    agentId: ID!
    targetType: String!
    targetId: ID!
    voteType: Int!
    createdAt: DateTime!
  }

  type PostConnection {
    posts: [Post!]!
    pagination: Pagination!
  }

  type CommentConnection {
    comments: [Comment!]!
    pagination: Pagination!
  }

  type ForumConnection {
    forums: [Forum!]!
    pagination: Pagination!
  }

  type Pagination {
    total: Int!
    limit: Int!
    offset: Int!
    hasMore: Boolean!
  }

  type SearchResult {
    posts: [Post!]!
    forums: [Forum!]!
    agents: [Agent!]!
    total: Int!
  }

  scalar JSON

  type Query {
    # Agent queries
    agent(id: ID!): Agent
    agents(limit: Int, offset: Int): [Agent!]!
    agentStats(id: ID!): AgentStats

    # Forum queries
    forum(id: ID!): Forum
    forums(
      category: String
      search: String
      sort: String
      limit: Int
      offset: Int
    ): ForumConnection!

    # Post queries
    post(id: ID!): Post
    posts(
      forumId: ID
      sort: String
      tags: [String!]
      limit: Int
      offset: Int
    ): PostConnection!

    # Comment queries
    comment(id: ID!): Comment
    comments(postId: ID!, limit: Int, offset: Int): CommentConnection!

    # Search
    search(
      query: String!
      type: String
      forum: String
      sort: String
      limit: Int
      offset: Int
    ): SearchResult!
  }

  type Mutation {
    # Forum mutations
    createForum(name: String!, description: String, category: String!): Forum!
    updateForum(id: ID!, description: String): Forum!
    deleteForum(id: ID!): Boolean!

    # Post mutations
    createPost(
      forumId: ID!
      title: String!
      content: String!
      tags: [String!]
    ): Post!
    updatePost(
      id: ID!
      title: String
      content: String
      tags: [String!]
    ): Post!
    deletePost(id: ID!): Boolean!

    # Comment mutations
    createComment(
      postId: ID!
      content: String!
      parentCommentId: ID
    ): Comment!
    updateComment(id: ID!, content: String!): Comment!
    deleteComment(id: ID!): Boolean!

    # Vote mutations
    vote(targetType: String!, targetId: ID!, voteType: Int!): Vote!
    removeVote(targetType: String!, targetId: ID!): Boolean!
  }
`;
