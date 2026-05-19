-- Recuperação de senha self-service + troca obrigatória no primeiro acesso.
--
-- Aditiva: só ALTER TABLE ADD COLUMN com DEFAULT. Não toca dados nem
-- tabelas existentes. Segue o padrão das flags da 0035.
--
-- must_change_password  1 = a senha atual é provisória (gerada pelo admin
--                       ao criar/redefinir, ou pelo fluxo "esqueci a senha").
--                       O login funciona, mas o cliente força a tela de
--                       criar senha nova antes de liberar a plataforma.
-- pwd_expires_at        unix seconds em que a senha provisória expira
--                       (NULL = senha definitiva, sem expiração). Após
--                       expirar, o login é recusado e o usuário precisa
--                       gerar outra via "Esqueceu sua senha?".

ALTER TABLE app_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_users ADD COLUMN pwd_expires_at       INTEGER;
