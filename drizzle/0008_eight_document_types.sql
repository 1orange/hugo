ALTER TABLE "companies" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The office's eight document types (2026-11-12): cash and card receipts are one type,
-- "06 Iné doklady" is "06 Ostatné dokumenty". The next sweep stores the same for files.
UPDATE "files" SET "folder_slot" = '04 Bločky' WHERE "folder_slot" IN ('04 Platby hotovosťou', '05 Platby kartou');--> statement-breakpoint
UPDATE "files" SET "folder_slot" = '06 Ostatné dokumenty' WHERE "folder_slot" = '06 Iné doklady';--> statement-breakpoint
UPDATE "documents" SET "folder_slot" = '04 Bločky' WHERE "folder_slot" IN ('04 Platby hotovosťou', '05 Platby kartou');--> statement-breakpoint
UPDATE "documents" SET "folder_slot" = '06 Ostatné dokumenty' WHERE "folder_slot" = '06 Iné doklady';--> statement-breakpoint
UPDATE "late_arrivals" SET "folder_slot" = '04 Bločky' WHERE "folder_slot" IN ('04 Platby hotovosťou', '05 Platby kartou');--> statement-breakpoint
UPDATE "late_arrivals" SET "folder_slot" = '06 Ostatné dokumenty' WHERE "folder_slot" = '06 Iné doklady';
