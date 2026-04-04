-- Meeting AI Assistant - Initial Schema

CREATE TABLE IF NOT EXISTS meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_url TEXT NOT NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('zoom', 'google_meet')),
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'joining', 'in_progress', 'ended', 'failed')),
    title VARCHAR(500),
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcript_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker VARCHAR(200),
    content TEXT NOT NULL,
    start_time FLOAT NOT NULL,
    end_time FLOAT,
    confidence FLOAT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transcript_lines_meeting_id ON transcript_lines(meeting_id);
CREATE INDEX idx_transcript_lines_start_time ON transcript_lines(meeting_id, start_time);

CREATE TABLE IF NOT EXISTS action_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    task TEXT NOT NULL,
    owner VARCHAR(200),
    due_date DATE,
    priority VARCHAR(10) DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high')),
    source_sentence TEXT,
    jira_ticket_id VARCHAR(50),
    jira_sync_status VARCHAR(20) DEFAULT 'pending'
        CHECK (jira_sync_status IN ('pending', 'synced', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_action_items_meeting_id ON action_items(meeting_id);
