-- Every proactive outbound message the agent wants to send (the scheduled
-- digests' group post and management/owner/IT DM, and -- going forward --
-- anything else the agent initiates rather than replies to) now goes
-- through IT for review first, instead of being delivered directly. Built
-- after a live incident: a scheduled digest posted hallucinated content and
-- another leaked its own tool-call narration as literal message text,
-- neither of which a human ever saw before it would have gone out.
--
-- Deliberately separate from `pending_confirmations` (crew-submitted
-- business actions reviewed by management) -- this is agent-initiated
-- messages reviewed by IT, a different actor and a different kind of
-- decision (edit-then-send, not just approve/reject a business record).
CREATE TABLE message_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL, -- e.g. 'digest_morning_group', 'digest_morning_management', 'critical_notification'
  target_description TEXT NOT NULL, -- human-readable, e.g. "Crew group" or "Management, Owner, IT"
  target_group_jid TEXT, -- set for a group send
  target_roles TEXT[], -- set for a role-queried DM fan-out (mirrors send_role_digest)
  draft_text TEXT NOT NULL,
  final_text TEXT, -- set on approval; may equal draft_text or be IT's edited version
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  -- Exactly one of target_group_jid / target_roles must be set -- a draft
  -- always has a single well-defined destination, never both or neither.
  CONSTRAINT message_drafts_target_check CHECK (
    (target_group_jid IS NOT NULL AND target_roles IS NULL) OR
    (target_group_jid IS NULL AND target_roles IS NOT NULL)
  )
);

CREATE INDEX message_drafts_status_idx ON message_drafts (status);
