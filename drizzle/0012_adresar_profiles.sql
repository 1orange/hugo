ALTER TABLE "company_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "company_profiles" CASCADE;--> statement-breakpoint
DROP INDEX "subjects_linked_company";--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_linked_company_once" ON "subjects" USING btree ("linked_company_id") WHERE "subjects"."linked_company_id" IS NOT NULL;