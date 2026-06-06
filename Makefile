.PHONY: test dev deploy-worker deploy-pages secrets typecheck

test:
	cd worker && npm test

typecheck:
	cd worker && npm run typecheck

dev:
	cd worker && npx wrangler dev --local

deploy-worker:
	cd worker && npx wrangler deploy

deploy-pages:
	npx wrangler pages deploy frontend/ --project-name booking

secrets:
	@echo "Enter secrets one by one:"
	cd worker && npx wrangler secret put CALDAV_USERNAME
	cd worker && npx wrangler secret put CALDAV_PASSWORD
	cd worker && npx wrangler secret put SMTP_USERNAME
	cd worker && npx wrangler secret put SMTP_PASSWORD
