import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from './user.entity.js';

@Check('admin_bootstrap_markers_singleton_ck', 'singleton')
@Unique('admin_bootstrap_markers_user_uq', ['userId'])
@Entity({ name: 'admin_bootstrap_markers' })
export class AdminBootstrapMarkerEntity {
  @PrimaryColumn({ type: 'boolean', default: true }) singleton!: boolean;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'admin_bootstrap_markers_user_fk',
  })
  user!: UserEntity;

  @Column({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
