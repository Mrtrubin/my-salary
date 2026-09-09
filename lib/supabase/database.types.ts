export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      performance_points: {
        Row: {
          created_at: string
          id: string
          name: string
          points_per_yuan: number
          status: Database["public"]["Enums"]["employment_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          points_per_yuan: number
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          points_per_yuan?: number
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
        }
        Relationships: []
      }
      performance_records: {
        Row: {
          created_at: string
          host_profile_id: string | null
          id: string
          month: string
          profile_id: string
          reject_reason: string | null
          revenue_cents: number
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["performance_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          host_profile_id?: string | null
          id?: string
          month: string
          profile_id: string
          reject_reason?: string | null
          revenue_cents: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["performance_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          host_profile_id?: string | null
          id?: string
          month?: string
          profile_id?: string
          reject_reason?: string | null
          revenue_cents?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["performance_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_records_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_records_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          code: string
          created_at: string
          default_permissions: string[]
          id: number
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          default_permissions?: string[]
          id?: never
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          default_permissions?: string[]
          id?: never
          name?: string
        }
        Relationships: []
      }
      profile_change_requests: {
        Row: {
          batch_id: string
          created_at: string
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          profile_id: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          secret_value: string | null
          status: Database["public"]["Enums"]["change_request_status"]
          updated_at: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          profile_id: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          secret_value?: string | null
          status?: Database["public"]["Enums"]["change_request_status"]
          updated_at?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          profile_id?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          secret_value?: string | null
          status?: Database["public"]["Enums"]["change_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_change_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_change_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string | null
          hire_date: string
          id: string
          id_card: string | null
          name: string
          phone: string
          status: Database["public"]["Enums"]["employment_status"]
          system_role: Database["public"]["Enums"]["system_role"]
          updated_at: string
          username: string | null
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          hire_date: string
          id?: string
          id_card?: string | null
          name: string
          phone?: string
          status?: Database["public"]["Enums"]["employment_status"]
          system_role?: Database["public"]["Enums"]["system_role"]
          updated_at?: string
          username?: string | null
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          hire_date?: string
          id?: string
          id_card?: string | null
          name?: string
          phone?: string
          status?: Database["public"]["Enums"]["employment_status"]
          system_role?: Database["public"]["Enums"]["system_role"]
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      salary_records: {
        Row: {
          commission_rate_bps: number
          created_at: string
          gross_cents: number
          guaranteed_component_cents: number
          id: string
          is_grace_period: boolean
          is_qualified: boolean
          month: string
          net_cents: number
          performance_component_cents: number
          position_id: number
          profile_id: string
          revenue_cents: number
          scheme_id: string | null
          service_fee_cents: number
          status: Database["public"]["Enums"]["salary_record_status"]
          tenure_month: number
          threshold_cents: number
          updated_at: string
        }
        Insert: {
          commission_rate_bps: number
          created_at?: string
          gross_cents: number
          guaranteed_component_cents: number
          id?: string
          is_grace_period: boolean
          is_qualified: boolean
          month: string
          net_cents: number
          performance_component_cents: number
          position_id: number
          profile_id: string
          revenue_cents: number
          scheme_id?: string | null
          service_fee_cents: number
          status?: Database["public"]["Enums"]["salary_record_status"]
          tenure_month: number
          threshold_cents: number
          updated_at?: string
        }
        Update: {
          commission_rate_bps?: number
          created_at?: string
          gross_cents?: number
          guaranteed_component_cents?: number
          id?: string
          is_grace_period?: boolean
          is_qualified?: boolean
          month?: string
          net_cents?: number
          performance_component_cents?: number
          position_id?: number
          profile_id?: string
          revenue_cents?: number
          scheme_id?: string | null
          service_fee_cents?: number
          status?: Database["public"]["Enums"]["salary_record_status"]
          tenure_month?: number
          threshold_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_records_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_records_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "salary_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_schemes: {
        Row: {
          base_salary_cents: number
          commission_rate_bps: number
          created_at: string
          effective_from: string
          guaranteed_salary_cents: number
          id: string
          name: string
          position_id: number | null
          profile_id: string | null
          status: Database["public"]["Enums"]["scheme_status"]
          threshold_multiplier_bps: number
          version: number
        }
        Insert: {
          base_salary_cents: number
          commission_rate_bps: number
          created_at?: string
          effective_from: string
          guaranteed_salary_cents: number
          id?: string
          name: string
          position_id?: number | null
          profile_id?: string | null
          status?: Database["public"]["Enums"]["scheme_status"]
          threshold_multiplier_bps?: number
          version: number
        }
        Update: {
          base_salary_cents?: number
          commission_rate_bps?: number
          created_at?: string
          effective_from?: string
          guaranteed_salary_cents?: number
          id?: string
          name?: string
          position_id?: number | null
          profile_id?: string | null
          status?: Database["public"]["Enums"]["scheme_status"]
          threshold_multiplier_bps?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "salary_schemes_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_schemes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          profile_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_performance_points: {
        Row: {
          created_at: string
          point_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          point_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          point_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_performance_points_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "performance_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_performance_points_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_performance_records: {
        Row: {
          broadcast_minutes: number
          created_at: string
          host_profile_id: string
          id: string
          no_perf: boolean
          no_perf_note: string | null
          perf_date: string
          point_id: string | null
          points_amount: number
          profile_id: string
          reject_reason: string | null
          revenue_cents: number
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["performance_status"]
          submitted_at: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          broadcast_minutes?: number
          created_at?: string
          host_profile_id: string
          id?: string
          no_perf?: boolean
          no_perf_note?: string | null
          perf_date: string
          point_id?: string | null
          points_amount?: number
          profile_id: string
          reject_reason?: string | null
          revenue_cents?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["performance_status"]
          submitted_at?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          broadcast_minutes?: number
          created_at?: string
          host_profile_id?: string
          id?: string
          no_perf?: boolean
          no_perf_note?: string | null
          perf_date?: string
          point_id?: string | null
          points_amount?: number
          profile_id?: string
          reject_reason?: string | null
          revenue_cents?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["performance_status"]
          submitted_at?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_performance_records_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_performance_records_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "performance_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_performance_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_performance_records_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_performance_records_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          host_profile_id: string
          id: string
          name: string
          status: Database["public"]["Enums"]["employment_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          host_profile_id: string
          id?: string
          name: string
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          host_profile_id?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_positions: {
        Row: {
          created_at: string
          position_id: number
          profile_id: string
        }
        Insert: {
          created_at?: string
          position_id: number
          profile_id: string
        }
        Update: {
          created_at?: string
          position_id?: number
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_positions_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_positions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_profile_id: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      change_request_status: "pending" | "approved" | "rejected" | "superseded"
      employment_status: "active" | "disabled"
      performance_status: "draft" | "pending" | "approved" | "rejected"
      salary_record_status: "draft" | "confirmed" | "published" | "voided"
      scheme_status: "active" | "archived"
      system_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      change_request_status: ["pending", "approved", "rejected", "superseded"],
      employment_status: ["active", "disabled"],
      performance_status: ["draft", "pending", "approved", "rejected"],
      salary_record_status: ["draft", "confirmed", "published", "voided"],
      scheme_status: ["active", "archived"],
      system_role: ["admin", "user"],
    },
  },
} as const
