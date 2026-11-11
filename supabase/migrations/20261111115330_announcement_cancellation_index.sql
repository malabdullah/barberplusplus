begin;
create index announcement_campaigns_cancelled_by on private.announcement_campaigns(cancelled_by)where cancelled_by is not null;
commit;
