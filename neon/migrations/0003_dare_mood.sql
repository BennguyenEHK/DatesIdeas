-- Adds "dare" to the deck: playful challenges alongside the questions, drawn
-- from the same shuffle so an evening can turn from a deep question to a silly
-- one without anybody choosing to change the subject.
--
-- The constraint is replaced rather than added to. A second CHECK would ANDed
-- with the first, so the old one would go on rejecting every 'dare' row while
-- the migration reported success.

alter table card_game drop constraint if exists card_game_mood_check;

alter table card_game add constraint card_game_mood_check
  check (mood in ('light', 'us', 'deep', 'dare'));
