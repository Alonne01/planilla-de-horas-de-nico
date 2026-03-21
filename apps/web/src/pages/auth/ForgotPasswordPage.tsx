import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import api from '@/services/api';
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const forgotPasswordSchema = z.object({
  email: z.string().email('Email inválido'),
});

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordForm) => {
    setError('');
    try {
      await api.post('/auth/forgot-password', { email: data.email });
      setSent(true);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        setError(axiosErr.response?.data?.error ?? 'Error al enviar el email');
      } else {
        setError('Error de conexión con el servidor');
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Mail className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Recuperar Contraseña
          </h1>
          <p className="text-muted-foreground mt-1">
            Ingresá tu email y te enviaremos un link para restablecer tu contraseña
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-lg">
          {sent ? (
            /* Success state */
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 mb-4">
                <CheckCircle2 className="w-6 h-6 text-green-400" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Email enviado
              </h2>
              <p className="text-sm text-muted-foreground mb-6">
                Si el email existe en nuestro sistema, recibirás un link para restablecer tu contraseña.
                Revisá tu bandeja de entrada y la carpeta de spam.
              </p>
              <Link
                to="/login"
                className={cn(
                  'inline-flex items-center gap-2 h-10 px-6 rounded-lg',
                  'bg-primary text-primary-foreground font-medium text-sm',
                  'hover:bg-primary/90 transition-all duration-200'
                )}
              >
                <ArrowLeft className="h-4 w-4" />
                Volver al login
              </Link>
            </div>
          ) : (
            /* Form state */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" id="forgot-password-form">
              {error && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="forgot-email" className="text-sm font-medium text-foreground">
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  placeholder="tu@email.com"
                  className={cn(
                    'flex h-10 w-full rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm',
                    'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
                    'transition-colors',
                    errors.email && 'border-destructive focus:ring-destructive'
                  )}
                  {...register('email')}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                id="forgot-password-submit"
                className={cn(
                  'w-full h-10 rounded-lg bg-primary text-primary-foreground font-medium text-sm',
                  'hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
                  'transition-all duration-200 flex items-center justify-center gap-2',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                {isSubmitting ? 'Enviando...' : 'Enviar link de recuperación'}
              </button>
            </form>
          )}
        </div>

        {/* Back to login link */}
        {!sent && (
          <div className="text-center mt-6">
            <Link
              to="/login"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" />
              Volver al login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
