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
      system_settlement_settings: {
        Row: {
          id: boolean
          settlement_type: Database["public"]["Enums"]["settlement_type"]
          settlement_start_day: number
          last_settled_period_end: string | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          settlement_type?: Database["public"]["Enums"]["settlement_type"]
          settlement_start_day?: number
          last_settled_period_end?: string | null
          updated_at?: string
        }
        Update: {
          settlement_type?: Database["public"]["Enums"]["settlement_type"]
          settlement_start_day?: number
          last_settled_period_end?: string | null
        }
        Relationships: []
      }
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
          anchor_base_commission_bps: number
         anchor_type: Database["public"]["Enums"]["anchor_type"]
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
          anchor_base_commission_bps?: number
          anchor_type?: Database["public"]["Enums"]["anchor_type"]
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
          anchor_base_commission_bps?: number
          anchor_type?: Database["public"]["Enums"]["anchor_type"]
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
          adjustments: Json
          attendance_bonus_bps: number
          dy_task_bonus_bps: number
          base_guarantee_cents: number
          commission_rate_bps: number
          base_commission_rate_bps: number
          commission_start_cents: number
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
          team_id: string | null
          period_start: string
          period_end: string
          review_pending_at: string | null
          confirm_pending_at: string | null
          confirmed_at: string | null
          completed_at: string | null
          reviewed_by: string | null
          confirmed_by: string | null
          completed_by: string | null
        }
        Insert: {
          adjustments?: Json
          attendance_bonus_bps?: number
          dy_task_bonus_bps?: number
          base_guarantee_cents?: number
          commission_rate_bps: number
          base_commission_rate_bps?: number
          commission_start_cents?: number
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
          team_id?: string | null
          period_start: string
          period_end: string
          review_pending_at?: string | null
          confirm_pending_at?: string | null
          confirmed_at?: string | null
          completed_at?: string | null
          reviewed_by?: string | null
          confirmed_by?: string | null
          completed_by?: string | null
        }
        Update: {
          adjustments?: Json
          attendance_bonus_bps?: number
          dy_task_bonus_bps?: number
          base_guarantee_cents?: number
          commission_rate_bps?: number
          base_commission_rate_bps?: number
          commission_start_cents?: number
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
          team_id?: string | null
          period_start?: string
          period_end?: string
          review_pending_at?: string | null
          confirm_pending_at?: string | null
          confirmed_at?: string | null
          completed_at?: string | null
          reviewed_by?: string | null
          confirmed_by?: string | null
          completed_by?: string | null
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
          id: string
          joined_at: string
          left_at: string | null
          profile_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          profile_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          profile_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
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
      anchor_revenue_records: {
        Row: {
          broadcast_minutes: number
          created_at: string
          id: string
          no_perf: boolean
          no_perf_note: string | null
          perf_date: string
          point_id: string | null
          points_amount: number
          profile_id: string
          revenue_cents: number
          team_id: string
          updated_at: string
        }
        Insert: {
          broadcast_minutes?: number
          created_at?: string
          id?: string
          no_perf?: boolean
          no_perf_note?: string | null
          perf_date: string
          point_id?: string | null
          points_amount?: number
          profile_id: string
          revenue_cents?: number
          team_id: string
          updated_at?: string
        }
        Update: {
          broadcast_minutes?: number
          created_at?: string
          id?: string
          no_perf?: boolean
          no_perf_note?: string | null
          perf_date?: string
          point_id?: string | null
          points_amount?: number
          profile_id?: string
          revenue_cents?: number
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anchor_revenue_records_point_id_fkey"
            columns: ["point_id"]
            isOneToOne: false
            referencedRelation: "performance_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anchor_revenue_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anchor_revenue_records_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          profile_id: string
          read_at: string | null
          ref_id: string | null
          title: string
          type: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          profile_id: string
          read_at?: string | null
          ref_id?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          profile_id?: string
          read_at?: string | null
          ref_id?: string | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      salary_record_status_logs: {
        Row: {
          created_at: string
          from_status:
            | Database["public"]["Enums"]["salary_record_status"]
            | null
          id: string
          note: string | null
          operator_profile_id: string | null
          salary_record_id: string
          to_status: Database["public"]["Enums"]["salary_record_status"]
        }
        Insert: {
          created_at?: string
          from_status?:
            | Database["public"]["Enums"]["salary_record_status"]
            | null
          id?: string
          note?: string | null
          operator_profile_id?: string | null
          salary_record_id: string
          to_status: Database["public"]["Enums"]["salary_record_status"]
        }
        Update: {
          created_at?: string
          from_status?:
            | Database["public"]["Enums"]["salary_record_status"]
            | null
          id?: string
          note?: string | null
          operator_profile_id?: string | null
          salary_record_id?: string
          to_status?: Database["public"]["Enums"]["salary_record_status"]
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          host_profile_id: string
          id: string
          name: string
          status: Database["public"]["Enums"]["employment_status"]
          updated_at: string
          settlement_type: Database["public"]["Enums"]["settlement_type"]
          settlement_start_day: number
          last_settled_period_end: string | null
        }
        Insert: {
          created_at?: string
          host_profile_id: string
          id?: string
          name: string
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
      settlement_type?: Database["public"]["Enums"]["settlement_type"]
          settlement_start_day?: number
          last_settled_period_end?: string | null
        }
        Update: {
          created_at?: string
          host_profile_id?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
          settlement_type?: Database["public"]["Enums"]["settlement_type"]
          settlement_start_day?: number
          last_settled_period_end?: string | null
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
      transition_salary_status: {
        Args: {
          p_id: string
          p_to_status: "pending_review" | "pending_confirm" | "confirmed" | "completed"
          p_operator_profile_id?: string | null
          p_note?: string | null
        }
        Returns: undefined
      }
      settle_anchor_revenue: {
        Args: {
          p_team_id: string | null
          p_period_start: string
          p_period_end: string
          p_members: Json
        }
        Returns: number
      }
      recompute_salary_record: {
        Args: {
          p_id: string
          p_attendance_bonus_bps?: Json
          p_dy_task_bonus_bps?: Json
          p_adjustments?: Json
          p_note?: string | null
        }
        Returns: undefined
      }
    }
    Enums: {
      anchor_type: "new" | "experienced"
      change_request_status: "pending" | "approved" | "rejected" | "superseded"
      employment_status: "active" | "disabled"
      salary_record_status: "pending_review" | "pending_confirm" | "confirmed" | "completed"
      scheme_status: "active" | "archived"
      system_role: "admin" | "user"
      settlement_type: "monthly" | "custom"
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
      anchor_type: ["new", "experienced"],
      change_request_status: ["pending", "approved", "rejected", "superseded"],
      employment_status: ["active", "disabled"],
      salary_record_status: ["pending_review", "pending_confirm", "confirmed", "completed"],
      scheme_status: ["active", "archived"],
      system_role: ["admin", "user"],
      settlement_type: ["monthly", "custom"],
    },
  },
} as const
