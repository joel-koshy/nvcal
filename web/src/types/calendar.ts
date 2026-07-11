import type { OAuthProvider } from "./user";

export interface Calendar {
  id: string;
  user_id: string;
  name: string;
  color_hex: string; // Default: '#FFFFFF'
  timezone: string; // Default: 'UTC'

  // External Integration Sync Metadata
  is_external: boolean; // Mapped from DB INTEGER 0/1
  external_provider: OAuthProvider | null;
  external_calendar_id: string | null;

  sync_token: string | null;

  version: number; // OCC Versioning
}

