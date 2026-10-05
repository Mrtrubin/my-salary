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
      anchor_adjustment_records: {
        Row: {
          adjust_date: string
          amount_cents: number
          anchor_profile_id: string
          created_at: string
          id: string
          name: string
          note: string | null
          registered_by: string | null
          source: string
          updated_at: string
        }
        Insert: {
          adjust_date: string
          amount_cents: number
          anchor_profile_id: string
          created_at?: string
          id?: string
          name: string
          note?: string | null
          registered_by?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          adjust_date?: string
          amount_cents?: number
          anchor_profile_id?: string
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          registered_by?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anchor_adjustment_records_anchor_profile_id_fkey"
            columns: ["anchor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anchor_adjustment_records_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      anchor_delay_records: {
        Row: {
          anchor_profile_id: string
          created_at: string
          delay_date: string
          id: string
          is_delayed: boolean
          note: string | null
          registered_by: string | null
          updated_at: string
        }
        Insert: {
          anchor_profile_id: string
          created_at?: string
          delay_date: string
          id?: string
          is_delayed?: boolean
          note?: string | null
          registered_by?: string | null
          updated_at?: string
        }
        Update: {
          anchor_profile_id?: string
          created_at?: string
          delay_date?: string
          id?: string
          is_delayed?: boolean
          note?: string | null
          registered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anchor_delay_records_anchor_profile_id_fkey"
            columns: ["anchor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anchor_delay_records_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      anchor_revenue_records: {
        Row: {
          adjustment_cents: number
          adjustments: Json
          broadcast_minutes: number
          created_at: string
          host_profile_id: string | null
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
          adjustment_cents?: number
          adjustments?: Json
          broadcast_minutes?: number
          created_at?: string
          host_profile_id?: string | null
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
          adjustment_cents?: number
          adjustments?: Json
          broadcast_minutes?: number
          created_at?: string
          host_profile_id?: string | null
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
            foreignKeyName: "anchor_revenue_records_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
      anchor_reward_records: {
        Row: {
          amount_cents: number
          anchor_profile_id: string
          created_at: string
          id: string
          name: string
          note: string | null
          registered_by: string | null
          reward_date: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          anchor_profile_id: string
          created_at?: string
          id?: string
          name: string
          note?: string | null
          registered_by?: string | null
          reward_date: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          anchor_profile_id?: string
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          registered_by?: string | null
          reward_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anchor_reward_records_anchor_profile_id_fkey"
            columns: ["anchor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anchor_reward_records_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      host_salary_record_status_logs: {
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
        Relationships: [
          {
            foreignKeyName: "host_salary_record_status_logs_operator_profile_id_fkey"
            columns: ["operator_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_salary_record_status_logs_salary_record_id_fkey"
            columns: ["salary_record_id"]
            isOneToOne: false
            referencedRelation: "host_salary_records"
            referencedColumns: ["id"]
          },
        ]
      }
      host_salary_records: {
        Row: {
          adjustments: Json
          base_commission_rate_bps: number
          base_income_cents: number
          broadcast_minutes: number
          commission_rate_bps: number
          completed_at: string | null
          completed_by: string | null
          confirm_pending_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          gross_cents: number
          host_profile_id: string
          id: string
          is_qualified: boolean
          month: string
          net_cents: number
          period_end: string
          period_start: string
          revenue_cents: number
          review_pending_at: string | null
          reviewed_by: string | null
          scheme_id: string | null
          service_fee_cents: number
          service_fee_rate_bps: number
          status: Database["public"]["Enums"]["salary_record_status"]
          team_breakdown: Json
          threshold_cents: number
          tier_bonus_bps: number
          updated_at: string
        }
        Insert: {
          adjustments?: Json
          base_commission_rate_bps: number
          base_income_cents?: number
          broadcast_minutes?: number
          commission_rate_bps: number
          completed_at?: string | null
          completed_by?: string | null
          confirm_pending_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          gross_cents: number
          host_profile_id: string
          id?: string
          is_qualified: boolean
          month: string
          net_cents: number
          period_end: string
          period_start: string
          revenue_cents: number
          review_pending_at?: string | null
          reviewed_by?: string | null
          scheme_id?: string | null
          service_fee_cents: number
          service_fee_rate_bps?: number
          status?: Database["public"]["Enums"]["salary_record_status"]
          team_breakdown?: Json
          threshold_cents: number
          tier_bonus_bps?: number
          updated_at?: string
        }
        Update: {
          adjustments?: Json
          base_commission_rate_bps?: number
          base_income_cents?: number
          broadcast_minutes?: number
          commission_rate_bps?: number
          completed_at?: string | null
          completed_by?: string | null
          confirm_pending_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          gross_cents?: number
          host_profile_id?: string
          id?: string
          is_qualified?: boolean
          month?: string
          net_cents?: number
          period_end?: string
          period_start?: string
          revenue_cents?: number
          review_pending_at?: string | null
          reviewed_by?: string | null
          scheme_id?: string | null
          service_fee_cents?: number
          service_fee_rate_bps?: number
          status?: Database["public"]["Enums"]["salary_record_status"]
          team_breakdown?: Json
          threshold_cents?: number
          tier_bonus_bps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "host_salary_records_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_salary_records_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_salary_records_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_salary_records_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_salary_records_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "host_salary_schemes"
            referencedColumns: ["id"]
          },
        ]
      }
      host_salary_schemes: {
        Row: {
          base_commission_rate_bps: number
          base_income_cents: number
          commission_start_cents: number
          created_at: string
          effective_from: string
          id: string
          name: string
          profile_id: string | null
          role_id: number | null
          service_fee_rate_bps: number
          status: Database["public"]["Enums"]["scheme_status"]
          version: number
        }
        Insert: {
          base_commission_rate_bps?: number
          base_income_cents?: number
          commission_start_cents?: number
          created_at?: string
          effective_from: string
          id?: string
          name: string
          profile_id?: string | null
          role_id?: number | null
          service_fee_rate_bps?: number
          status?: Database["public"]["Enums"]["scheme_status"]
          version: number
        }
        Update: {
          base_commission_rate_bps?: number
          base_income_cents?: number
          commission_start_cents?: number
          created_at?: string
          effective_from?: string
          id?: string
          name?: string
          profile_id?: string | null
          role_id?: number | null
          service_fee_rate_bps?: number
          status?: Database["public"]["Enums"]["scheme_status"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "host_salary_schemes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_salary_schemes_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          created_by_type: string
          id: string
          note: string | null
          occurred_at: string
          source_id: string | null
          source_type: string
          tag_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          created_by_type?: string
          id?: string
          note?: string | null
          occurred_at?: string
          source_id?: string | null
          source_type?: string
          tag_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          created_by_type?: string
          id?: string
          note?: string | null
          occurred_at?: string
          source_id?: string | null
          source_type?: string
          tag_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "ledger_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_tags: {
        Row: {
          code: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          status: Database["public"]["Enums"]["employment_status"]
          updated_at: string
        }
        Insert: {
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          status?: Database["public"]["Enums"]["employment_status"]
          updated_at?: string
        }
        Relationships: []
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
        Relationships: [
          {
            foreignKeyName: "notifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          douyin_id: string | null
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
          douyin_id?: string | null
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
          douyin_id?: string | null
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
      roles: {
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
        Relationships: [
          {
            foreignKeyName: "salary_record_status_logs_operator_profile_id_fkey"
            columns: ["operator_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_record_status_logs_salary_record_id_fkey"
            columns: ["salary_record_id"]
            isOneToOne: false
            referencedRelation: "salary_records"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_records: {
        Row: {
          adjustments: Json
          attendance_bonus_bps: number
          base_commission_rate_bps: number
          base_guarantee_cents: number
          broadcast_minutes: number
          commission_rate_bps: number
          commission_start_cents: number
          completed_at: string | null
          completed_by: string | null
          confirm_pending_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          dy_task_bonus_bps: number
          gross_cents: number
          guaranteed_component_cents: number
          id: string
          is_grace_period: boolean
          is_qualified: boolean
          month: string
          net_cents: number
          note: string
          performance_component_cents: number
          period_end: string
          period_start: string
          profile_id: string
          revenue_cents: number
          review_pending_at: string | null
          reviewed_by: string | null
          role_id: number
          scheme_id: string | null
          service_fee_cents: number
          service_fee_rate_bps: number
          status: Database["public"]["Enums"]["salary_record_status"]
          team_id: string | null
          tenure_month: number
          threshold_cents: number
          updated_at: string
        }
        Insert: {
          adjustments?: Json
          attendance_bonus_bps?: number
          base_commission_rate_bps?: number
          base_guarantee_cents?: number
          broadcast_minutes?: number
          commission_rate_bps: number
          commission_start_cents?: number
          completed_at?: string | null
          completed_by?: string | null
          confirm_pending_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          dy_task_bonus_bps?: number
          gross_cents: number
          guaranteed_component_cents: number
          id?: string
          is_grace_period: boolean
          is_qualified: boolean
          month: string
          net_cents: number
          note?: string
          performance_component_cents: number
          period_end: string
          period_start: string
          profile_id: string
          revenue_cents: number
          review_pending_at?: string | null
          reviewed_by?: string | null
          role_id: number
          scheme_id?: string | null
          service_fee_cents: number
          service_fee_rate_bps?: number
          status?: Database["public"]["Enums"]["salary_record_status"]
          team_id?: string | null
          tenure_month: number
          threshold_cents: number
          updated_at?: string
        }
        Update: {
          adjustments?: Json
          attendance_bonus_bps?: number
          base_commission_rate_bps?: number
          base_guarantee_cents?: number
          broadcast_minutes?: number
          commission_rate_bps?: number
          commission_start_cents?: number
          completed_at?: string | null
          completed_by?: string | null
          confirm_pending_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          dy_task_bonus_bps?: number
          gross_cents?: number
          guaranteed_component_cents?: number
          id?: string
          is_grace_period?: boolean
          is_qualified?: boolean
          month?: string
          net_cents?: number
          note?: string
          performance_component_cents?: number
          period_end?: string
          period_start?: string
          profile_id?: string
          revenue_cents?: number
          review_pending_at?: string | null
          reviewed_by?: string | null
          role_id?: number
          scheme_id?: string | null
          service_fee_cents?: number
          service_fee_rate_bps?: number
          status?: Database["public"]["Enums"]["salary_record_status"]
          team_id?: string | null
          tenure_month?: number
          threshold_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_records_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_records_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            foreignKeyName: "salary_records_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_records_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_records_scheme_id_fkey"
            columns: ["scheme_id"]
            isOneToOne: false
            referencedRelation: "salary_schemes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_records_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
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
          profile_id: string | null
          role_id: number | null
          service_fee_rate_bps: number
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
          profile_id?: string | null
          role_id?: number | null
          service_fee_rate_bps?: number
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
          profile_id?: string | null
          role_id?: number | null
          service_fee_rate_bps?: number
          status?: Database["public"]["Enums"]["scheme_status"]
          threshold_multiplier_bps?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "salary_schemes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_schemes_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_adjustment_records: {
        Row: {
          adjust_date: string
          amount_cents: number
          created_at: string
          id: string
          name: string
          note: string | null
          profile_id: string
          registered_by: string | null
          role_code: string
          updated_at: string
        }
        Insert: {
          adjust_date: string
          amount_cents: number
          created_at?: string
          id?: string
          name: string
          note?: string | null
          profile_id: string
          registered_by?: string | null
          role_code?: string
          updated_at?: string
        }
        Update: {
          adjust_date?: string
          amount_cents?: number
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          profile_id?: string
          registered_by?: string | null
          role_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_adjustment_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_adjustment_records_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_base_incomes: {
        Row: {
          base_income_cents: number
          id: number
          profile_id: string
          role_id: number
          updated_at: string
        }
        Insert: {
          base_income_cents?: number
          id?: never
          profile_id: string
          role_id: number
          updated_at?: string
        }
        Update: {
          base_income_cents?: number
          id?: never
          profile_id?: string
          role_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_base_incomes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_base_incomes_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_salary_record_status_logs: {
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
        Relationships: [
          {
            foreignKeyName: "staff_salary_record_status_logs_operator_profile_id_fkey"
            columns: ["operator_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_record_status_logs_salary_record_id_fkey"
            columns: ["salary_record_id"]
            isOneToOne: false
            referencedRelation: "staff_salary_records"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_salary_records: {
        Row: {
          adjustment_cents: number
          base_income_cents: number
          completed_at: string | null
          completed_by: string | null
          confirm_pending_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          gross_cents: number
          id: string
          month: string
          net_cents: number
          note: string | null
          penalty_cents: number
          period_end: string
          period_start: string
          profile_id: string
          review_pending_at: string | null
          reviewed_by: string | null
          reward_cents: number
          role_id: number
          status: Database["public"]["Enums"]["salary_record_status"]
          tax_cents: number
          updated_at: string
        }
        Insert: {
          adjustment_cents: number
          base_income_cents?: number
          completed_at?: string | null
          completed_by?: string | null
          confirm_pending_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          gross_cents: number
          id?: string
          month: string
          net_cents: number
          note?: string | null
          penalty_cents?: number
          period_end: string
          period_start: string
          profile_id: string
          review_pending_at?: string | null
          reviewed_by?: string | null
          reward_cents?: number
          role_id: number
          status?: Database["public"]["Enums"]["salary_record_status"]
          tax_cents?: number
          updated_at?: string
        }
        Update: {
          adjustment_cents?: number
          base_income_cents?: number
          completed_at?: string | null
          completed_by?: string | null
          confirm_pending_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          gross_cents?: number
          id?: string
          month?: string
          net_cents?: number
          note?: string | null
          penalty_cents?: number
          period_end?: string
          period_start?: string
          profile_id?: string
          review_pending_at?: string | null
          reviewed_by?: string | null
          reward_cents?: number
          role_id?: number
          status?: Database["public"]["Enums"]["salary_record_status"]
          tax_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_salary_records_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_records_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_records_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_records_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_records_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
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
      teams: {
        Row: {
          created_at: string
          host_profile_id: string
          id: string
          name: string
          status: Database["public"]["Enums"]["employment_status"]
          team_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          host_profile_id: string
          id?: string
          name: string
          status?: Database["public"]["Enums"]["employment_status"]
          team_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          host_profile_id?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["employment_status"]
          team_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_host_profile_id_fkey"
            columns: ["host_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          profile_id: string
          role_id: number
        }
        Insert: {
          created_at?: string
          profile_id: string
          role_id: number
        }
        Update: {
          created_at?: string
          profile_id?: string
          role_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _anchor_compute_payroll: {
        Args: {
          p_adjustment_total_cents: number
          p_attendance_bonus_bps: number
          p_base_commission_rate_bps: number
          p_base_salary_cents: number
          p_dy_task_bonus_bps: number
          p_guaranteed_salary_cents: number
          p_monthly_revenue_cents: number
          p_service_fee_rate_bps?: number
          p_tenure_month: number
          p_threshold_multiplier_bps: number
        }
        Returns: Database["public"]["CompositeTypes"]["anchor_payroll_detail"]
        SetofOptions: {
          from: "*"
          to: "anchor_payroll_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _anchor_effective_scheme: {
        Args: { p_period_end: string; p_profile_id: string; p_role_id: number }
        Returns: {
          base_salary_cents: number
          created_at: string
          effective_from: string
          guaranteed_salary_cents: number
          id: string
          name: string
          profile_id: string | null
          role_id: number | null
          service_fee_rate_bps: number
          status: Database["public"]["Enums"]["scheme_status"]
          threshold_multiplier_bps: number
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "salary_schemes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _anchor_period_broadcast_minutes: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_profile_id: string
        }
        Returns: number
      }
      _anchor_period_revenue: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_profile_id: string
        }
        Returns: number
      }
      _anchor_tenure_month: {
        Args: { p_hire_date: string; p_period_end: string }
        Returns: number
      }
      _host_compute_payroll: {
        Args: {
          p_adjustment_total_cents: number
          p_base_commission_rate_bps: number
          p_base_income_cents: number
          p_commission_start_cents: number
          p_revenue_cents: number
          p_service_fee_rate_bps: number
        }
        Returns: Database["public"]["CompositeTypes"]["host_payroll_detail"]
        SetofOptions: {
          from: "*"
          to: "host_payroll_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _host_effective_scheme: {
        Args: { p_period_end: string; p_profile_id: string }
        Returns: {
          base_commission_rate_bps: number
          base_income_cents: number
          commission_start_cents: number
          created_at: string
          effective_from: string
          id: string
          name: string
          profile_id: string | null
          role_id: number | null
          service_fee_rate_bps: number
          status: Database["public"]["Enums"]["scheme_status"]
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "host_salary_schemes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _host_period_broadcast_minutes: {
        Args: {
          p_host_profile_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: number
      }
      _host_period_revenue: {
        Args: {
          p_host_profile_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: number
      }
      _host_period_team_breakdown: {
        Args: {
          p_host_profile_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: Json
      }
      _payroll_bps_arg: {
        Args: { p_key: string; p_member: Json }
        Returns: number
      }
      _payroll_rate_ceil: {
        Args: { p_amount: number; p_bps: number }
        Returns: number
      }
      _payroll_rate_floor: {
        Args: { p_amount: number; p_bps: number }
        Returns: number
      }
      create_staff_salary_records: {
        Args: { p_period_end: string; p_period_start: string; p_records: Json }
        Returns: number
      }
      current_member_team_id: { Args: never; Returns: string }
      current_profile_id: { Args: never; Returns: string }
      delete_anchor_reward: { Args: { p_id: string }; Returns: undefined }
      delete_host_salary_record: { Args: { p_id: string }; Returns: undefined }
      delete_salary_record: { Args: { p_id: string }; Returns: undefined }
      delete_staff_salary_record: { Args: { p_id: string }; Returns: undefined }
      get_ledger_summary: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_dance: { Args: never; Returns: boolean }
      is_hr_manager: { Args: never; Returns: boolean }
      is_makeup: { Args: never; Returns: boolean }
      is_team_host: { Args: { team_id: string }; Returns: boolean }
      list_anchor_adjustments: {
        Args: { p_end?: string; p_source?: string; p_start?: string }
        Returns: {
          adjust_date: string
          amount_cents: number
          anchor_name: string
          anchor_profile_id: string
          id: string
          name: string
          note: string
          registered_by: string
          registered_name: string
          source: string
          updated_at: string
        }[]
      }
      list_anchor_delays: {
        Args: { p_end?: string; p_start?: string }
        Returns: {
          anchor_name: string
          anchor_profile_id: string
          delay_date: string
          id: string
          is_delayed: boolean
          note: string
          registered_by: string
          registered_name: string
          updated_at: string
        }[]
      }
      list_anchor_members: {
        Args: never
        Returns: {
          base_salary_cents: number
          id: string
          name: string
        }[]
      }
      list_anchor_rewards: {
        Args: { p_end?: string; p_start?: string }
        Returns: {
          amount_cents: number
          anchor_name: string
          anchor_profile_id: string
          id: string
          name: string
          note: string
          registered_by: string
          registered_name: string
          reward_date: string
          updated_at: string
        }[]
      }
      list_staff_adjustments: {
        Args: { p_end?: string; p_role_code?: string; p_start?: string }
        Returns: {
          adjust_date: string
          amount_cents: number
          id: string
          name: string
          note: string
          profile_id: string
          profile_name: string
          registered_by: string
          registered_name: string
          role_code: string
          updated_at: string
        }[]
      }
      list_staff_members: {
        Args: { p_role_code: string }
        Returns: {
          base_income_cents: number
          id: string
          name: string
        }[]
      }
      recompute_host_salary_record: {
        Args: { p_adjustments?: Json; p_id: string; p_note?: string }
        Returns: undefined
      }
      recompute_salary_record:
        | {
            Args: {
              p_adjustments?: Json
              p_attendance_bonus_bps?: Json
              p_dy_task_bonus_bps?: Json
              p_id: string
              p_note?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_commission_rate_bps: number
              p_gross_cents: number
              p_guaranteed_component_cents: number
              p_id: string
              p_is_grace_period: boolean
              p_is_qualified: boolean
              p_net_cents: number
              p_note?: string
              p_performance_component_cents: number
              p_revenue_cents: number
              p_service_fee_cents: number
              p_tenure_month: number
              p_threshold_cents: number
            }
            Returns: undefined
          }
      recompute_staff_salary_record: {
        Args: { p_id: string; p_note?: string }
        Returns: undefined
      }
      set_anchor_delays: {
        Args: {
          p_anchor_ids: string[]
          p_delay_date: string
          p_is_delayed: boolean
          p_note?: string
        }
        Returns: number
      }
      set_anchor_rewards: {
        Args: {
          p_amount_cents: number
          p_anchor_ids: string[]
          p_name: string
          p_note?: string
          p_reward_date: string
        }
        Returns: number
      }
      set_dance_adjustments: {
        Args: { p_date: string; p_entries: Json; p_registered_by?: string }
        Returns: number
      }
      set_staff_adjustments: {
        Args: {
          p_date: string
          p_entries: Json
          p_registered_by?: string
          p_role_code: string
        }
        Returns: number
      }
      set_staff_base_income: {
        Args: { p_cents: number; p_profile_id: string; p_role_code: string }
        Returns: undefined
      }
      settle_anchor_revenue: {
        Args: {
          p_members: Json
          p_period_end: string
          p_period_start: string
          p_replace_overlapping?: boolean
          p_team_id: string
        }
        Returns: number
      }
      settle_host_payroll: {
        Args: {
          p_hosts: Json
          p_period_end: string
          p_period_start: string
          p_replace_overlapping?: boolean
        }
        Returns: number
      }
      transition_host_salary_status: {
        Args: {
          p_id: string
          p_note?: string
          p_operator_profile_id?: string
          p_to_status: Database["public"]["Enums"]["salary_record_status"]
        }
        Returns: undefined
      }
      transition_salary_status: {
        Args: {
          p_id: string
          p_note?: string
          p_operator_profile_id?: string
          p_to_status: Database["public"]["Enums"]["salary_record_status"]
        }
        Returns: undefined
      }
      transition_staff_salary_status: {
        Args: {
          p_id: string
          p_note?: string
          p_operator_profile_id?: string
          p_to_status: Database["public"]["Enums"]["salary_record_status"]
        }
        Returns: undefined
      }
      update_anchor_reward: {
        Args: {
          p_amount_cents: number
          p_id: string
          p_name: string
          p_note?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      anchor_type: "new" | "experienced"
      change_request_status: "pending" | "approved" | "rejected" | "superseded"
      employment_status: "active" | "disabled"
      salary_record_status:
        | "pending_review"
        | "pending_confirm"
        | "confirmed"
        | "completed"
      scheme_status: "active" | "archived"
      system_role: "admin" | "user"
    }
    CompositeTypes: {
      anchor_payroll_detail: {
        threshold_cents: number | null
        is_qualified: boolean | null
        is_grace_period: boolean | null
        base_guarantee_cents: number | null
        commission_start_cents: number | null
        commission_rate_bps: number | null
        guaranteed_component_cents: number | null
        performance_component_cents: number | null
        gross_cents: number | null
        service_fee_cents: number | null
        net_cents: number | null
      }
      host_payroll_detail: {
        threshold_cents: number | null
        is_qualified: boolean | null
        tier_steps: number | null
        tier_bonus_bps: number | null
        commission_rate_bps: number | null
        base_income_cents: number | null
        performance_component_cents: number | null
        gross_cents: number | null
        service_fee_cents: number | null
        net_cents: number | null
      }
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
      salary_record_status: [
        "pending_review",
        "pending_confirm",
        "confirmed",
        "completed",
      ],
      scheme_status: ["active", "archived"],
      system_role: ["admin", "user"],
    },
  },
} as const
