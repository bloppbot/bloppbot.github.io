-- Make positions readable by any authenticated user (writes still owner-only).
drop policy if exists positions_rw on public.positions;
create policy positions_read on public.positions
  for select using (auth.role() = 'authenticated');
create policy positions_write on public.positions
  for insert with check (auth.uid() = user_id);
create policy positions_update on public.positions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy positions_delete on public.positions
  for delete using (auth.uid() = user_id);
