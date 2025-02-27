import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('visitors')
export class Visitor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 45 })
  ip: string;

  @Column({ type: 'varchar', length: 100 })
  device: string;

  @Column({ type: 'varchar', length: 100 })
  browser: string;

  @Column({ type: 'varchar', length: 50 })
  latitude: string;

  @Column({ type: 'varchar', length: 50 })
  longitude: string;

  @Column({ type: 'varchar', length: 50 })
  source: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
}
