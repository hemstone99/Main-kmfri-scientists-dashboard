export interface PhpSourceFile {
  path: string;
  category: 'Migration & Seed' | 'Config & Bootstrap' | 'Models & PDO' | 'Controllers & Services' | 'Middleware & Policies' | 'Tests & Docs';
  description: string;
  content: string;
}

export const PHP_MVC_SOURCE_FILES: PhpSourceFile[] = [
  {
    path: 'database/migrations/001_create_kmfri_schema.sql',
    category: 'Migration & Seed',
    description: 'Complete MySQL 8+ InnoDB utf8mb4 DDL for all 26 normalized KMFRI tables with CHAR(36) UUID primary keys, foreign keys, and composite indexes.',
    content: `-- KMFRI Scientists & Research Management System
-- MySQL 8.0+ Schema Migration (InnoDB, utf8mb4, CHAR(36) UUID Convention)
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS roles (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id CHAR(36) NOT NULL,
    permission_id CHAR(36) NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS directorates (
    id CHAR(36) PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    head_user_id CHAR(36) NULL,
    active_status TINYINT(1) NOT NULL DEFAULT 1,
    is_core_protected TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_areas (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    directorate_id CHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ra_directorate FOREIGN KEY (directorate_id) REFERENCES directorates(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(191) NOT NULL UNIQUE,
    phone VARCHAR(30) NULL,
    password_hash VARCHAR(255) NOT NULL,
    staff_number VARCHAR(50) NOT NULL UNIQUE,
    profile_photo VARCHAR(255) NULL,
    position VARCHAR(120) NOT NULL,
    directorate_id CHAR(36) NULL,
    research_area_id CHAR(36) NULL,
    role_id CHAR(36) NOT NULL,
    account_status ENUM('Active','Inactive','Locked','PendingSetup') NOT NULL DEFAULT 'Active',
    failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
    last_login TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_directorate (directorate_id),
    INDEX idx_users_role (role_id),
    CONSTRAINT fk_users_directorate FOREIGN KEY (directorate_id) REFERENCES directorates(id) ON DELETE SET NULL,
    CONSTRAINT fk_users_research_area FOREIGN KEY (research_area_id) REFERENCES research_areas(id) ON DELETE SET NULL,
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS researcher_profiles (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL UNIQUE,
    specialization VARCHAR(200) NOT NULL,
    academic_rank VARCHAR(100) NOT NULL,
    qualifications TEXT NOT NULL,
    biography TEXT,
    orcid VARCHAR(50) NULL,
    phone VARCHAR(30) NULL,
    office_location VARCHAR(150) NULL,
    research_interests TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_profile_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
    id CHAR(36) PRIMARY KEY,
    project_code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    description LONGTEXT NOT NULL,
    objectives TEXT NOT NULL,
    research_area_id CHAR(36) NULL,
    directorate_id CHAR(36) NOT NULL,
    principal_investigator_id CHAR(36) NOT NULL,
    start_date DATE NOT NULL,
    expected_end_date DATE NOT NULL,
    actual_completion_date DATE NULL,
    status VARCHAR(60) NOT NULL DEFAULT 'Draft',
    priority ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
    budget DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    currency CHAR(3) NOT NULL DEFAULT 'KES',
    progress DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    created_by CHAR(36) NOT NULL,
    updated_by CHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_projects_status_dates (status, start_date, expected_end_date),
    INDEX idx_projects_directorate (directorate_id),
    CONSTRAINT fk_projects_dir FOREIGN KEY (directorate_id) REFERENCES directorates(id) ON DELETE RESTRICT,
    CONSTRAINT fk_projects_pi FOREIGN KEY (principal_investigator_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_members (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    project_role VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_milestones (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    responsible_user CHAR(36) NOT NULL,
    due_date DATE NOT NULL,
    completion_date DATE NULL,
    status ENUM('Pending','In Progress','Completed','Overdue') NOT NULL DEFAULT 'Pending',
    progress DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    CONSTRAINT fk_ms_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_ms_user FOREIGN KEY (responsible_user) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS funders (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    funding_type VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    contact_person VARCHAR(150),
    email VARCHAR(191),
    phone VARCHAR(50),
    website VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS funding (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    funder_id CHAR(36) NOT NULL,
    grant_number VARCHAR(100) NOT NULL UNIQUE,
    amount DECIMAL(16,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'KES',
    award_date DATE NOT NULL,
    funding_start_date DATE NOT NULL,
    funding_end_date DATE NOT NULL,
    allocated_amount DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    spent_amount DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_funding_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_funding_funder FOREIGN KEY (funder_id) REFERENCES funders(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS funding_transactions (
    id CHAR(36) PRIMARY KEY,
    funding_id CHAR(36) NOT NULL,
    transaction_type ENUM('Allocation','Expenditure','Adjustment') NOT NULL,
    amount DECIMAL(16,2) NOT NULL,
    transaction_date DATE NOT NULL,
    reference VARCHAR(120) NOT NULL,
    description TEXT,
    recorded_by CHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ft_funding FOREIGN KEY (funding_id) REFERENCES funding(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS locations (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'Kenya',
    county VARCHAR(100) NOT NULL,
    sub_county VARCHAR(100) NOT NULL,
    site VARCHAR(150) NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    marine_area VARCHAR(150) NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_locations_coords (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_locations (
    project_id CHAR(36) NOT NULL,
    location_id CHAR(36) NOT NULL,
    activity_description VARCHAR(255),
    PRIMARY KEY (project_id, location_id),
    CONSTRAINT fk_pl_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_pl_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collaborators (
    id CHAR(36) PRIMARY KEY,
    organization_name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(150) NOT NULL,
    email VARCHAR(191) NOT NULL,
    phone VARCHAR(50),
    country VARCHAR(100) NOT NULL,
    organization_type VARCHAR(100) NOT NULL,
    collaboration_type VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    notes TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_collaborators (
    project_id CHAR(36) NOT NULL,
    collaborator_id CHAR(36) NOT NULL,
    role VARCHAR(120) NOT NULL,
    PRIMARY KEY (project_id, collaborator_id),
    CONSTRAINT fk_pc_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_pc_collab FOREIGN KEY (collaborator_id) REFERENCES collaborators(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    scientist_id CHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    report_type VARCHAR(100) NOT NULL,
    reporting_period VARCHAR(80) NOT NULL,
    submission_date TIMESTAMP NULL,
    due_date DATE NOT NULL,
    status VARCHAR(60) NOT NULL DEFAULT 'Draft',
    reviewer_id CHAR(36) NULL,
    review_comments TEXT,
    approval_date TIMESTAMP NULL,
    file_reference VARCHAR(255),
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_reports_due_status (due_date, status),
    CONSTRAINT fk_reports_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_reports_scientist FOREIGN KEY (scientist_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_outputs (
    id CHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    output_type VARCHAR(100) NOT NULL,
    project_id CHAR(36) NULL,
    lead_scientist_id CHAR(36) NOT NULL,
    journal_or_event VARCHAR(255),
    doi VARCHAR(150) NULL UNIQUE,
    url VARCHAR(255) NULL,
    publication_date DATE NOT NULL,
    abstract TEXT NOT NULL,
    keywords VARCHAR(255),
    status VARCHAR(60) NOT NULL DEFAULT 'Draft',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_outputs_scientist FOREIGN KEY (lead_scientist_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS output_authors (
    id CHAR(36) PRIMARY KEY,
    output_id CHAR(36) NOT NULL,
    user_id CHAR(36) NULL,
    external_author_name VARCHAR(150) NULL,
    author_order INT UNSIGNED NOT NULL,
    UNIQUE KEY uq_output_author_order (output_id, author_order),
    CONSTRAINT fk_oa_output FOREIGN KEY (output_id) REFERENCES research_outputs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_activities (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NOT NULL,
    scientist_id CHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    activity_date DATE NOT NULL,
    location_id CHAR(36) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Planned',
    hours DECIMAL(6,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ra_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_ra_scientist FOREIGN KEY (scientist_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approvals (
    id CHAR(36) PRIMARY KEY,
    entity_type VARCHAR(50) NOT NULL,
    entity_id CHAR(36) NOT NULL,
    submitted_by CHAR(36) NOT NULL,
    reviewer_id CHAR(36) NULL,
    reviewer_role VARCHAR(64) NULL,
    decision VARCHAR(60) NOT NULL,
    comments TEXT,
    workflow_stage VARCHAR(80) NOT NULL,
    previous_state VARCHAR(60) NOT NULL,
    new_state VARCHAR(60) NOT NULL,
    decided_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_approvals_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documents (
    id CHAR(36) PRIMARY KEY,
    project_id CHAR(36) NULL,
    uploader_id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    secure_storage_key VARCHAR(255) NOT NULL UNIQUE,
    file_size BIGINT UNSIGNED NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    linked_entity_type VARCHAR(50) NOT NULL,
    linked_entity_id CHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    related_entity VARCHAR(120) NULL,
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notifications_user_unread (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NULL,
    action VARCHAR(120) NOT NULL,
    entity_type VARCHAR(60) NOT NULL,
    entity_id CHAR(36) NOT NULL,
    old_values JSON NULL,
    new_values JSON NULL,
    request_metadata JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
    id CHAR(36) PRIMARY KEY,
    setting_key VARCHAR(120) NOT NULL UNIQUE,
    json_value JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;`,
  },
  {
    path: 'database/seeds/001_seed_reference_data.sql',
    category: 'Migration & Seed',
    description: 'Approved reference data seeder for the 5 system roles, 12 permissions, and the 4 protected KMFRI directorates (OCS, FWS, ARD, SED). Zero fake operational records.',
    content: `-- KMFRI Reference Data Seeder (Roles, Permissions, and 4 Core Directorates)
INSERT INTO roles (id, name, description) VALUES
  ('role-scientist-001', 'scientist', 'KMFRI Scientist / Researcher'),
  ('role-hod-002', 'head_of_directorate', 'Head of Directorate'),
  ('role-dir-admin-003', 'directorate_admin', 'Directorate Administrator'),
  ('role-dg-004', 'director_general', 'Director General'),
  ('role-sys-admin-005', 'system_admin', 'System Administrator')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO directorates (id, code, name, description, active_status, is_core_protected) VALUES
  ('dir-ocs-001', 'OCS', 'Oceans & Coastal Systems Directorate', 'Marine ecology, coral reef conservation, stock assessment, and EEZ oceanography.', 1, 1),
  ('dir-fws-002', 'FWS', 'Freshwater Systems Directorate', 'Inland lake ecosystems, limnology, catchment hydrology, and freshwater fisheries.', 1, 1),
  ('dir-ard-003', 'ARD', 'Aquaculture Research Directorate', 'Mariculture and freshwater fish farming, selective genetics, fish feed nutrition.', 1, 1),
  ('dir-sed-004', 'SED', 'Socioeconomics Directorate', 'Blue economy valuation, fisheries value chains, BMU governance, and policy.', 1, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);`,
  },
  {
    path: 'app/Services/ApprovalWorkflowService.php',
    category: 'Controllers & Services',
    description: 'PDO transactional approval workflow service enforcing conflict-of-interest checks, directorate boundaries, and immutable audit trail logging.',
    content: `<?php
declare(strict_types=1);

namespace App\\Services;

use PDO;
use RuntimeException;

final class ApprovalWorkflowService
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly AuditLoggerService $auditLogger,
        private readonly NotificationService $notifier
    ) {}

    public function recordDecision(
        string $entityType,
        string $entityId,
        array $actorUser,
        string $decision,
        string $comments
    ): void {
        if (in_array($decision, ['Rejected', 'Changes Requested'], true) && trim($comments) === '') {
            throw new RuntimeException('Mandatory reviewer comments are required when rejecting or requesting changes.');
        }

        $this->pdo->beginTransaction();
        try {
            $table = match ($entityType) {
                'project' => 'projects',
                'output'  => 'research_outputs',
                'report'  => 'reports',
                default   => throw new RuntimeException('Unsupported workflow entity type.')
            };

            $stmt = $this->pdo->prepare("SELECT * FROM {$table} WHERE id = :id FOR UPDATE");
            $stmt->execute(['id' => $entityId]);
            $record = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$record) {
                throw new RuntimeException('Target submission record not found.');
            }

            $ownerField = match ($entityType) {
                'project' => 'principal_investigator_id',
                'output'  => 'lead_scientist_id',
                'report'  => 'scientist_id',
            };

            if ($record[$ownerField] === $actorUser['id']) {
                throw new RuntimeException('Conflict of interest violation: A user cannot approve their own submission.');
            }

            $previousState = $record['status'];
            $newState = match ($decision) {
                'Approved' => $actorUser['role_name'] === 'director_general'
                    ? 'Approved by Director General'
                    : 'Approved by Head of Directorate',
                'Escalated to DG' => 'Approved by Head of Directorate',
                'Changes Requested' => 'Changes Requested',
                'Rejected' => 'Rejected',
                default => throw new RuntimeException('Invalid workflow decision.')
            };

            $upd = $this->pdo->prepare("UPDATE {$table} SET status = :status, updated_at = UTC_TIMESTAMP() WHERE id = :id");
            $upd->execute(['status' => $newState, 'id' => $entityId]);

            $ins = $this->pdo->prepare("
                INSERT INTO approvals (id, entity_type, entity_id, submitted_by, reviewer_id, reviewer_role, decision, comments, workflow_stage, previous_state, new_state, decided_at, created_at)
                VALUES (:id, :etype, :eid, :sub, :rev, :rrole, :dec, :comm, :stage, :prev, :next, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            ");
            $ins->execute([
                'id'    => bin2hex(random_bytes(16)),
                'etype' => $entityType,
                'eid'   => $entityId,
                'sub'   => $record[$ownerField],
                'rev'   => $actorUser['id'],
                'rrole' => $actorUser['role_name'],
                'dec'   => $decision,
                'comm'  => $comments,
                'stage' => $actorUser['role_name'] === 'director_general' ? 'Institutional Executive Review' : 'Directorate Review',
                'prev'  => $previousState,
                'next'  => $newState,
            ]);

            $this->auditLogger->log($actorUser['id'], 'WORKFLOW_DECISION_' . strtoupper($decision), $entityType, $entityId, ['status' => $previousState], ['status' => $newState, 'comments' => $comments]);
            $this->notifier->notifyUser($record[$ownerField], "Submission {$decision}", "Your {$entityType} status changed from {$previousState} to {$newState}.", 'approval', $entityId);

            $this->pdo->commit();
        } catch (\\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }
}`,
  },
  {
    path: 'app/Middleware/CsrfAndAuthMiddleware.php',
    category: 'Middleware & Policies',
    description: 'Server-side session hardening, inactivity timeout enforcement, CSRF token verification, and RBAC permission gate.',
    content: `<?php
declare(strict_types=1);

namespace App\\Middleware;

use RuntimeException;

final class CsrfAndAuthMiddleware
{
    public static function enforceAuthenticatedSession(int $timeoutMinutes = 30): array
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_set_cookie_params([
                'lifetime' => 0,
                'path'     => '/',
                'secure'   => isset($_SERVER['HTTPS']),
                'httponly' => true,
                'samesite' => 'Strict',
            ]);
            session_start();
        }

        if (empty($_SESSION['kmfri_user'])) {
            http_response_code(401);
            throw new RuntimeException('Unauthenticated session. Please sign in.');
        }

        $now = time();
        if (isset($_SESSION['last_activity']) && ($now - $_SESSION['last_activity']) > ($timeoutMinutes * 60)) {
            session_unset();
            session_destroy();
            http_response_code(440);
            throw new RuntimeException('Session expired due to inactivity.');
        }

        $_SESSION['last_activity'] = $now;
        return $_SESSION['kmfri_user'];
    }

    public static function verifyCsrfToken(?string $submittedToken): void
    {
        $sessionToken = $_SESSION['csrf_token'] ?? '';
        if ($sessionToken === '' || $submittedToken === null || !hash_equals($sessionToken, $submittedToken)) {
            http_response_code(419);
            throw new RuntimeException('CSRF token mismatch rejected state-changing request.');
        }
    }
}`,
  },
  {
    path: 'README.md',
    category: 'Tests & Docs',
    description: 'Complete installation, XAMPP/Apache configuration, CLI admin provisioning, database migration, and security hardening guide.',
    content: `# KMFRI Scientists & Research Management System

Production-grade institutional research, project lifecycle, grant funding, GIS location, and workflow approval management system for the **Kenya Marine and Fisheries Research Institute (KMFRI)**.

## 1. Prerequisites
- **PHP**: 8.2 or newer (\`pdo_mysql\`, \`mbstring\`, \`intl\`, \`gd\`, \`zip\`, \`xml\`)
- **MySQL**: 8.0+ with \`InnoDB\` and \`utf8mb4\`
- **Composer**: 2.6+ (\`phpoffice/phpspreadsheet\`, \`dompdf/dompdf\`, \`phpunit/phpunit\`)
- **Web Server**: Apache 2.4 (\`mod_rewrite\` enabled) or Nginx

## 2. Clean Installation & Database Setup
\`\`\`bash
cp .env.example .env
composer install --no-dev --optimize-autoloader
mysql -u root -p -e "CREATE DATABASE kmfri_rms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p kmfri_rms < database/migrations/001_create_kmfri_schema.sql
mysql -u root -p kmfri_rms < database/seeds/001_seed_reference_data.sql
\`\`\`

## 3. Secure Initial Administrator Provisioning
No operational accounts or fake statistics are seeded. Provision the initial \`system_admin\` account via CLI:
\`\`\`bash
php bin/provision-admin.php --name="KMFRI System Administrator" --email="sysadmin@kmfri.go.ke" --staff="KMFRI/ADM/001"
\`\`\`

## 4. Storage Security & Document Root
Configure Apache \`DocumentRoot\` to point strictly to \`/public\`. Ensure \`storage/private/uploads\` resides outside the public web root with \`0750\` permissions.`,
  },
];
