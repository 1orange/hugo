CREATE TABLE "subject_alias_sightings" (
	"subject_id" integer NOT NULL,
	"normalized_name" text NOT NULL,
	"document_id" text NOT NULL,
	"sighted_at" text NOT NULL,
	CONSTRAINT "subject_alias_sightings_subject_id_normalized_name_document_id_pk" PRIMARY KEY("subject_id","normalized_name","document_id")
);
--> statement-breakpoint
ALTER TABLE "subject_alias_sightings" ADD CONSTRAINT "subject_alias_sightings_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;