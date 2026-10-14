import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
  MaxLength,
  IsString,
} from 'class-validator';
export enum Hazard {
  Gas = 'gas',
  ElectricalPanel = 'electrical_panel',
  StructuralDistress = 'structural_distress',
  Asbestos = 'asbestos',
  FloodingNearElectrics = 'flooding_near_electrics',
}
export class DiagnoseDto {
  @IsUUID() capture_id!: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Hazard, { each: true })
  hazards?: Hazard[];
  @IsOptional() @IsString() @MaxLength(2000) context?: string;
}
