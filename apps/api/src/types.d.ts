import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: {
      id: string;
      email: string;
      username: string;
      displayName: string;
      roles: string[];
      permissions: string[];
      sessionId: string;
    };
  }
}
