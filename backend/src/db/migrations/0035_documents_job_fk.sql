-- documents.job_id has existed as a bare, unconstrained UUID since
-- 0016_documents.sql ("references a future jobs table if one is split out
-- from sites") -- that table now exists; wire up the FK it was always
-- waiting for.
ALTER TABLE documents ADD CONSTRAINT documents_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id);
