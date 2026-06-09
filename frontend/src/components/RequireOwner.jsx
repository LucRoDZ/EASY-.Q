import { SignedIn, SignedOut } from '@clerk/clerk-react';
import { Navigate } from 'react-router-dom';
import { useUserRole } from '../context/UserRoleContext';

export default function RequireOwner({ children }) {
  const { role, loading } = useUserRole();

  if (loading) return null;

  if (role === 'waiter') return <Navigate to="/waiter" replace />;
  if (role !== 'owner') return <Navigate to="/account" replace />;

  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut><Navigate to="/" replace /></SignedOut>
    </>
  );
}
