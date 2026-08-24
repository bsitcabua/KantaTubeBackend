import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum AuthProvider {
  GOOGLE = 'google',
  FACEBOOK = 'facebook',
}

@Entity('auth_accounts')
@Unique('uq_auth_accounts_provider_identity', ['provider', 'providerUserId'])
export class AuthAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_auth_accounts_user_id')
  @Column({ type: 'char', length: 36 })
  userId: string;

  @Column({ type: 'enum', enum: AuthProvider })
  provider: AuthProvider;

  @Column({ type: 'varchar', length: 255 })
  providerUserId: string;

  @Column({ type: 'varchar', length: 254, nullable: true })
  providerEmail: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  providerDisplayName: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  providerAvatarUrl: string | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.authAccounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
