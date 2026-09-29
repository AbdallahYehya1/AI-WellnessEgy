"""Auth: Supabase JWT verification and identity derivation.

This module never stores or checks passwords; Supabase Auth owns credentials.
Use ``app.auth.dependencies.CurrentPrincipal`` to protect a route.
"""
