insert into public.exercises (name, muscle_group, instructions)
select seed.name, seed.muscle_group, seed.instructions
from (
  values
    ('Agachamento livre', 'Pernas', 'Mantenha o peito aberto e desça com controle.'),
    ('Leg press', 'Pernas', 'Empurre a plataforma sem travar os joelhos.'),
    ('Cadeira extensora', 'Pernas', 'Estenda os joelhos de forma controlada.'),
    ('Mesa flexora', 'Pernas', 'Flexione os joelhos sem tirar o quadril do apoio.'),
    ('Levantamento terra', 'Posterior de coxa', 'Mantenha a coluna neutra durante todo o movimento.'),
    ('Avanço', 'Pernas', 'Dê um passo à frente e mantenha o joelho alinhado.'),
    ('Supino reto', 'Peito', 'Desça a barra até próximo ao peito e empurre com controle.'),
    ('Supino inclinado com halteres', 'Peito', 'Mantenha os ombros estáveis e controle a descida.'),
    ('Crucifixo com halteres', 'Peito', 'Faça um arco amplo sem perder o controle dos ombros.'),
    ('Flexão de braços', 'Peito', 'Mantenha o corpo alinhado durante a execução.'),
    ('Puxada frontal', 'Costas', 'Puxe a barra até a parte superior do peito.'),
    ('Remada baixa', 'Costas', 'Puxe os cotovelos para trás mantendo a coluna neutra.'),
    ('Remada curvada', 'Costas', 'Incline o tronco e mantenha a lombar estável.'),
    ('Elevação lateral', 'Ombros', 'Eleve os braços até a linha dos ombros sem impulsionar.'),
    ('Desenvolvimento com halteres', 'Ombros', 'Empurre os halteres acima da cabeça com controle.'),
    ('Rosca direta', 'Bíceps', 'Mantenha os cotovelos próximos ao corpo.'),
    ('Rosca martelo', 'Bíceps', 'Suba os halteres mantendo as palmas voltadas para dentro.'),
    ('Tríceps na polia', 'Tríceps', 'Estenda os cotovelos sem afastá-los do corpo.'),
    ('Tríceps francês', 'Tríceps', 'Mantenha os cotovelos apontados para cima.'),
    ('Prancha abdominal', 'Abdômen', 'Contraia o abdômen e mantenha o corpo alinhado.'),
    ('Abdominal supra', 'Abdômen', 'Eleve o tronco sem puxar o pescoço.'),
    ('Panturrilha em pé', 'Panturrilhas', 'Suba na ponta dos pés e desça lentamente.')
) as seed(name, muscle_group, instructions)
where not exists (
  select 1 from public.exercises existing
  where lower(existing.name) = lower(seed.name)
);
